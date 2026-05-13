from __future__ import annotations

import gc
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import HTTPException
from urllib3.exceptions import InsecureRequestWarning

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(path: Path) -> bool:
        env_path = Path(path)
        if not env_path.exists():
            return False
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue
            os.environ[key] = value.strip()
        return True

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from backend.sequence.schema import SequenceAIDraftRequest
from backend.sequence_rag import retrieve_references_for_request

logger = logging.getLogger(__name__)

SEQUENCE_AI_PROVIDER = os.getenv("SEQUENCE_AI_PROVIDER", "ollama").strip().lower()


OLLAMA_BASE_URL = os.getenv("SEQUENCE_AI_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("SEQUENCE_AI_MODEL", "llama3.1:8b")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("SEQUENCE_AI_TIMEOUT_SECONDS", "90"))
OPENAI_BASE_URL = os.getenv("SEQUENCE_AI_OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("SEQUENCE_AI_OPENAI_MODEL", "gpt-4o-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_TIMEOUT_SECONDS = float(os.getenv("SEQUENCE_AI_OPENAI_TIMEOUT_SECONDS", "90"))
LOCAL_MODEL_PATH = os.getenv(
    "SEQUENCE_AI_LOCAL_MODEL_PATH",
    str(Path("backend/finetune_sequence/models/Llama-3.1-8B-Instruct")),
)
LOCAL_ADAPTER_PATH = os.getenv(
    "SEQUENCE_AI_LOCAL_ADAPTER_PATH",
    str(Path("backend/finetune_sequence/outputs/lora")),
)
LOCAL_OFFLOAD_DIR = os.getenv(
    "SEQUENCE_AI_LOCAL_OFFLOAD_DIR",
    str(Path("backend/finetune_sequence/outputs/offload")),
)
LOCAL_DEVICE_MODE = os.getenv("SEQUENCE_AI_LOCAL_DEVICE_MODE", "gpu_only").strip().lower()
LOCAL_GPU_INDEX = int(os.getenv("SEQUENCE_AI_LOCAL_GPU_INDEX", "0"))
LOCAL_KEEP_MODEL_LOADED = os.getenv("SEQUENCE_AI_KEEP_MODEL_LOADED", "0").strip().lower() in {"1", "true", "yes", "on"}
LOCAL_MAX_NEW_TOKENS = int(os.getenv("SEQUENCE_AI_LOCAL_MAX_NEW_TOKENS", "192"))
LOCAL_TEMPERATURE = float(os.getenv("SEQUENCE_AI_LOCAL_TEMPERATURE", "0.0"))

_LOCAL_MODEL_CACHE: Optional[Tuple[Any, Any, str, str]] = None


def _is_truthy_env(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _resolve_sequence_ai_provider() -> str:
    use_openai_raw = os.getenv("SEQUENCE_AI_USE_OPENAI", "").strip()
    if use_openai_raw:
        return "openai" if _is_truthy_env(use_openai_raw) else "ollama"
    return os.getenv("SEQUENCE_AI_PROVIDER", SEQUENCE_AI_PROVIDER).strip().lower() or "ollama"


def _resolve_openai_verify_option() -> Any:
    openai_ca_bundle = os.getenv("SEQUENCE_AI_OPENAI_CA_BUNDLE", "").strip()
    openai_ssl_verify_raw = os.getenv("SEQUENCE_AI_OPENAI_SSL_VERIFY", "true").strip().lower()
    if openai_ca_bundle:
        return openai_ca_bundle
    if openai_ssl_verify_raw in {"0", "false", "no", "off"}:
        requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)
        return False
    return True


def _resolve_openai_api_settings() -> Tuple[str, str, str, float]:
    return (
        os.getenv("SEQUENCE_AI_OPENAI_BASE_URL", OPENAI_BASE_URL).strip(),
        os.getenv("SEQUENCE_AI_OPENAI_MODEL", OPENAI_MODEL).strip(),
        os.getenv("OPENAI_API_KEY", OPENAI_API_KEY).strip(),
        float(os.getenv("SEQUENCE_AI_OPENAI_TIMEOUT_SECONDS", str(OPENAI_TIMEOUT_SECONDS))),
    )


def _emit_progress(tag: str, message: str) -> None:
    return


def _build_system_prompt() -> str:
    return (
        "You generate an assembly sequence draft using only the given selectedParts and processTemplates. "
        "Never invent parts or processes. "
        "For PART steps, copy selectedParts.nodeName exactly with no alias or paraphrase. "
        "Treat selected PARTs as placed anchor parts and choose plausible PROCESS steps for each PART. "
        "When evidence is partial or indirect, prefer a rough-but-reasonable process family match from processTemplates "
        "instead of being overly conservative. "
        "Return exactly one JSON object with: groupLabel, confidence, reasoningSummary, sequence, warnings. "
        "Each step must be either "
        '{"type":"PART","nodeName":"...","reason":"..."} '
        'or {"type":"PROCESS","processKey":"...","reason":"..."}. '
        "Never recommend manual barcode reader scan/reading processes. "
        "Keep it concise, non-empty, and avoid overusing the same process unless strongly supported."
    )


def _build_user_prompt(payload: SequenceAIDraftRequest, context: Dict[str, Any] | None = None) -> str:
    selected_parts: List[Dict[str, Any]] = [
        {
            "nodeName": item.nodeName,
            "partId": item.partId,
            "partName": item.partName,
            "partBase": item.partBase,
            "sourceSheet": item.sourceSheet,
            "treePath": item.treePath or [],
            "parentName": item.parentName,
        }
        for item in payload.selectedParts
    ]
    process_templates: List[Dict[str, Any]] = [
        {
            "processKey": item.processKey,
            "label": item.label,
            "partBase": item.partBase,
            "sourceSheet": item.sourceSheet,
            "processType": item.processType,
        }
        for item in (payload.processTemplates or [])
    ]

    request_body = {
        "bomId": payload.bomId,
        "spec": payload.spec,
        "options": {
            "maxProcesses": payload.options.maxProcesses if payload.options else 5,
            "layoutDirection": payload.options.layoutDirection if payload.options else "LR",
            "autoConnect": payload.options.autoConnect if payload.options else True,
        },
        "selectedParts": selected_parts,
        "processTemplates": process_templates,
        "treeContext": context or {},
    }

    rag_context = retrieve_references_for_request(payload, limit=3)
    if rag_context.get("referenceWindows"):
        request_body["referenceWindows"] = rag_context["referenceWindows"]
    if rag_context.get("processCandidates"):
        request_body["processCandidates"] = rag_context["processCandidates"]
    if rag_context.get("partProcessRecommendations"):
        request_body["partProcessRecommendations"] = rag_context["partProcessRecommendations"]

    compact_request_body = json.dumps(
        request_body,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    return (
        "Build an assembly sequence draft from this input.\n"
        "Rules:\n"
        "1. Use every selected PART at most once.\n"
        "2. For PART steps, nodeName must be copied exactly from selectedParts.nodeName with identical spelling.\n"
        "3. Never output similar or inferred PART names such as aliases, abbreviations, translated names, or BOM/raw names.\n"
        "4. Use only processKey values from processTemplates.\n"
        "5. The sequence array must not be empty.\n"
        "6. Include at least two PART steps when two or more selected parts are given.\n"
        "7. Include PROCESS steps only when they are supported by selectedParts, processTemplates, referenceWindows, processCandidates, or partProcessRecommendations.\n"
        "8. Treat selected PARTs as already placed anchor parts. Choose individually plausible PROCESS steps for each PART, but be flexible.\n"
        "9. Do not copy the input order of selectedParts. The selectedParts array order is arbitrary and must not determine the sequence order.\n"
        "10. Prefer an order supported by referenceWindows, processCandidates, and process logic over any tree or input ordering hints.\n"
        "11. If exact evidence is weak, prefer a nearby plausible process family from processTemplates rather than returning too few PROCESS steps.\n"
        "12. Rough semantic matching is allowed for PROCESS selection, but the returned processKey must still come from processTemplates.\n"
        "13. Keep the sequence concise and avoid repeating one process family unless the input strongly supports it.\n"
        "14. Do not recommend manual barcode reader scan/reading processes such as 바코드 리딩, 바코드 스캔, or 단순 리딩 작업.\n"
        "15. Write groupLabel, reasoningSummary, warnings, and reason fields in Korean.\n"
        "16. Return JSON only.\n"
        "17. Bad example: {\"groupLabel\":\"...\",\"confidence\":0.4,\"reasoningSummary\":\"...\",\"sequence\":[],\"warnings\":[\"...\"]}\n"
        "18. Good example: {\"groupLabel\":\"조립 시퀀스\",\"confidence\":0.82,\"reasoningSummary\":\"선택 부품별로 가능한 공정을 폭넓게 검토했습니다.\",\"sequence\":[{\"type\":\"PART\",\"nodeName\":\"selectedParts의 정확한 nodeName\",\"reason\":\"기준 부품\"},{\"type\":\"PROCESS\",\"processKey\":\"입력 processTemplates의 공정 키\",\"reason\":\"직접 일치가 약해도 가장 가까운 조립 공정\"},{\"type\":\"PART\",\"nodeName\":\"selectedParts의 정확한 nodeName\",\"reason\":\"다음 기준 부품\"}],\"warnings\":[]}\n\n"
        f"INPUT_JSON:\n{compact_request_body}"
    )


def _build_chat_recommendation_system_prompt() -> str:
    return (
        "You are a manufacturing recommendation assistant. "
        "Choose the best matching parts and process candidates for the user's Korean request "
        "using only the provided candidate lists. "
        "Never invent parts or processes that are not in the candidates. "
        "Return exactly one JSON object with keys: reply, recommendedPartKeys, recommendedProcessKeys. "
        "recommendedPartKeys and recommendedProcessKeys must be arrays of strings."
    )


def _build_chat_recommendation_user_prompt(payload: Dict[str, Any]) -> str:
    compact_payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return (
        "Select the best candidates for this sequence chat request.\n"
        "Rules:\n"
        "1. Use only keys from candidateParts and candidateProcesses.\n"
        "2. Prefer candidates that directly match the request semantics.\n"
        "3. Keep the result concise.\n"
        "4. Write reply in Korean.\n"
        "5. Return JSON only.\n\n"
        f"INPUT_JSON:\n{compact_payload}"
    )


def _extract_json_object(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty model response")

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            snippet = text[start : end + 1]
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                repaired = _recover_draft_from_malformed_json(snippet)
                if repaired:
                    return repaired
        repaired = _recover_draft_from_malformed_json(text)
        if repaired:
            return repaired
        raise exc


def _recover_draft_from_malformed_json(text: str) -> Dict[str, Any]:
    repaired: Dict[str, Any] = {}

    group_label = _extract_json_string_field(text, "groupLabel")
    if group_label:
        repaired["groupLabel"] = group_label

    confidence = _extract_json_number_field(text, "confidence")
    if confidence is not None:
        repaired["confidence"] = confidence

    reasoning_summary = _extract_json_string_field(text, "reasoningSummary")
    if reasoning_summary:
        repaired["reasoningSummary"] = reasoning_summary

    warnings = _extract_json_string_array_field(text, "warnings")
    if warnings:
        repaired["warnings"] = warnings

    sequence = _extract_sequence_steps_from_text(text)
    if sequence:
        repaired["sequence"] = sequence

    if repaired:
        repaired.setdefault("warnings", [])
        repaired.setdefault("sequence", [])
    return repaired


def _extract_json_string_field(text: str, field_name: str) -> Optional[str]:
    pattern = rf'"{re.escape(field_name)}"\s*:\s*"((?:\\.|[^"\\])*)"'
    match = re.search(pattern, text, flags=re.DOTALL)
    if not match:
        return None
    return _decode_json_string(match.group(1))


def _extract_json_number_field(text: str, field_name: str) -> Optional[float]:
    pattern = rf'"{re.escape(field_name)}"\s*:\s*(-?\d+(?:\.\d+)?)'
    match = re.search(pattern, text)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _extract_json_string_array_field(text: str, field_name: str) -> List[str]:
    array_text = _extract_named_array_text(text, field_name)
    if not array_text:
        return []

    values: List[str] = []
    for item in re.finditer(r'"((?:\\.|[^"\\])*)"', array_text, flags=re.DOTALL):
        decoded = _decode_json_string(item.group(1)).strip()
        if decoded:
            values.append(decoded)
    return values


def _extract_sequence_steps_from_text(text: str) -> List[Dict[str, Any]]:
    array_text = _extract_named_array_text(text, "sequence")
    if not array_text:
        return []

    steps: List[Dict[str, Any]] = []
    for object_text in _split_top_level_json_objects(array_text):
        try:
            parsed = json.loads(object_text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            steps.append(parsed)
    return steps


def _extract_named_array_text(text: str, field_name: str) -> Optional[str]:
    match = re.search(rf'"{re.escape(field_name)}"\s*:\s*\[', text)
    if not match:
        return None
    start_index = match.end() - 1
    return _extract_balanced_json_block(text, start_index, "[", "]")


def _extract_balanced_json_block(text: str, start_index: int, open_char: str, close_char: str) -> Optional[str]:
    depth = 0
    in_string = False
    escape = False

    for index in range(start_index, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == open_char:
            depth += 1
            continue
        if char == close_char:
            depth -= 1
            if depth == 0:
                return text[start_index : index + 1]
    return None


def _split_top_level_json_objects(array_text: str) -> List[str]:
    objects: List[str] = []
    depth = 0
    in_string = False
    escape = False
    object_start: Optional[int] = None

    for index, char in enumerate(array_text):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            if depth == 0:
                object_start = index
            depth += 1
            continue
        if char == "}":
            if depth == 0:
                continue
            depth -= 1
            if depth == 0 and object_start is not None:
                objects.append(array_text[object_start : index + 1])
                object_start = None

    return objects


def _decode_json_string(value: str) -> str:
    try:
        return json.loads(f'"{value}"')
    except json.JSONDecodeError:
        return value.replace('\\"', '"').replace("\\n", "\n").replace("\\t", "\t").strip()


def _resolve_existing_path(path_str: str) -> Optional[Path]:
    path = Path(path_str)
    return path if path.exists() else None


def _load_local_generation_model() -> Tuple[Any, Any, str, str]:
    global _LOCAL_MODEL_CACHE

    model_path = _resolve_existing_path(LOCAL_MODEL_PATH)
    if model_path is None:
        raise HTTPException(
            status_code=500,
            detail=f"로컬 파인튜닝 모델 경로를 찾을 수 없습니다: {LOCAL_MODEL_PATH}",
        )

    adapter_path = _resolve_existing_path(LOCAL_ADAPTER_PATH)
    model_key = str(model_path.resolve())
    adapter_key = str(adapter_path.resolve()) if adapter_path else ""

    if _LOCAL_MODEL_CACHE and _LOCAL_MODEL_CACHE[2] == model_key and _LOCAL_MODEL_CACHE[3] == adapter_key:
        _emit_progress("[MODEL_CACHE_HIT]", f"model={model_key} adapter={adapter_key or '-'}")
        return _LOCAL_MODEL_CACHE

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="로컬 파인튜닝 모델 사용을 위해 transformers/torch 패키지가 필요합니다.",
        ) from exc

    tokenizer_source = str(adapter_path) if adapter_path else str(model_path)
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_source, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    if torch.cuda.is_available():
        cuda_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    else:
        cuda_dtype = torch.float32

    model_kwargs: Dict[str, Any] = {
        "dtype": cuda_dtype,
    }
    if torch.cuda.is_available():
        if LOCAL_DEVICE_MODE == "gpu_only":
            model_kwargs["device_map"] = {"": LOCAL_GPU_INDEX}
        else:
            model_kwargs["device_map"] = "auto"
            offload_dir = Path(LOCAL_OFFLOAD_DIR)
            offload_dir.mkdir(parents=True, exist_ok=True)
            model_kwargs["offload_folder"] = str(offload_dir)

    model = AutoModelForCausalLM.from_pretrained(str(model_path), **model_kwargs)
    _emit_progress("[BASE_MODEL_READY]", f"model={model_key}")

    if adapter_path:
        _emit_progress("[ADAPTER_LOAD_START]", f"adapter={adapter_key or '-'}")
        try:
            from peft import PeftModel
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="로컬 파인튜닝 adapter 사용을 위해 peft 패키지가 필요합니다.",
            ) from exc
        peft_kwargs: Dict[str, Any] = {}
        if torch.cuda.is_available():
            if LOCAL_DEVICE_MODE == "gpu_only":
                peft_kwargs["device_map"] = {"": LOCAL_GPU_INDEX}
            else:
                peft_kwargs["offload_folder"] = str(Path(LOCAL_OFFLOAD_DIR))
        model = PeftModel.from_pretrained(model, str(adapter_path), **peft_kwargs)
        _emit_progress("[ADAPTER_LOAD_DONE]", f"adapter={adapter_key or '-'}")

    model.eval()
    _configure_generation_defaults(model)
    _emit_progress(
        "[MODEL_LOADED]",
        "provider=finetuned_local "
        f"model={model_key} adapter={adapter_key or '-'} "
        f"deviceMode={LOCAL_DEVICE_MODE} keepLoaded={LOCAL_KEEP_MODEL_LOADED}",
    )
    _LOCAL_MODEL_CACHE = (tokenizer, model, model_key, adapter_key)
    return _LOCAL_MODEL_CACHE


def _release_local_model(tokenizer: Any, model: Any) -> None:
    global _LOCAL_MODEL_CACHE

    if LOCAL_KEEP_MODEL_LOADED:
        _emit_progress("[MODEL_RELEASE_SKIPPED]", "keepLoaded=true")
        return

    _LOCAL_MODEL_CACHE = None

    try:
        import torch
    except ImportError:
        torch = None  # type: ignore[assignment]

    del tokenizer
    del model
    gc.collect()

    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()
        if hasattr(torch.cuda, "ipc_collect"):
            torch.cuda.ipc_collect()
    _emit_progress("[MODEL_RELEASED]", "cacheCleared=true")


def _configure_generation_defaults(model: Any) -> None:
    generation_config = getattr(model, "generation_config", None)
    if generation_config is None:
        return

    generation_config.do_sample = LOCAL_TEMPERATURE > 0
    if generation_config.do_sample:
        generation_config.temperature = max(LOCAL_TEMPERATURE, 1e-6)
        generation_config.top_p = 0.95
    else:
        generation_config.temperature = None
        generation_config.top_p = None


def generate_sequence_draft_with_local_model(
    payload: SequenceAIDraftRequest,
    context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    prompt = _build_user_prompt(payload, context)
    system_prompt = _build_system_prompt()
    tokenizer, model, _, _ = _load_local_generation_model()
    try:
        _emit_progress(
            "[LOCAL_GENERATE_START]",
            f"bomId={payload.bomId} spec={payload.spec} "
            f"selectedParts={len(payload.selectedParts or [])} "
            f"processTemplates={len(payload.processTemplates or [])}",
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]
        if hasattr(tokenizer, "apply_chat_template"):
            rendered_prompt = tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        else:
            rendered_prompt = f"SYSTEM: {system_prompt}\nUSER: {prompt}\nASSISTANT:"

        encoded = tokenizer(rendered_prompt, return_tensors="pt")
        _emit_progress("[PROMPT_TOKENIZED]", f"inputTokens={encoded['input_ids'].shape[1]}")
        first_device = next(
            (parameter.device for parameter in model.parameters() if parameter.device.type != "meta"),
            None,
        )
        target_device = first_device if first_device is not None else model.device
        encoded = {key: value.to(target_device) for key, value in encoded.items()}
        _emit_progress("[INPUT_MOVED]", f"device={target_device}")

        try:
            import torch

            do_sample = LOCAL_TEMPERATURE > 0
            generation_kwargs: Dict[str, Any] = {
                "max_new_tokens": LOCAL_MAX_NEW_TOKENS,
                "do_sample": do_sample,
                "pad_token_id": tokenizer.pad_token_id,
                "eos_token_id": tokenizer.eos_token_id,
            }
            if do_sample:
                generation_kwargs["temperature"] = max(LOCAL_TEMPERATURE, 1e-6)
                generation_kwargs["top_p"] = 0.95

            _emit_progress(
                "[GENERATE_CALL]",
                f"maxNewTokens={LOCAL_MAX_NEW_TOKENS} doSample={do_sample}",
            )
            with torch.inference_mode():
                generated = model.generate(
                    **encoded,
                    **generation_kwargs,
                )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"로컬 파인튜닝 모델 추론 실패: {exc}",
            ) from exc

        generated_tokens = generated[0][encoded["input_ids"].shape[1] :]
        raw_text = tokenizer.decode(generated_tokens, skip_special_tokens=True)
        _emit_progress(
            "[LOCAL_GENERATE_DONE]",
            f"bomId={payload.bomId} spec={payload.spec} "
            f"responseChars={len(raw_text)} elapsed={time.perf_counter() - started_at:.2f}s",
        )
        try:
            parsed = _extract_json_object(raw_text)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"로컬 파인튜닝 모델 JSON 파싱 실패: {exc}",
            ) from exc

        model_name = Path(LOCAL_MODEL_PATH).name
        if _resolve_existing_path(LOCAL_ADAPTER_PATH):
            model_name = f"{model_name}+{Path(LOCAL_ADAPTER_PATH).name}"

        return {
            "provider": "finetuned_local",
            "model": model_name,
            "draft": parsed,
            "raw": {"response": raw_text},
        }
    finally:
        _release_local_model(tokenizer, model)


def generate_sequence_draft_with_ollama(
    payload: SequenceAIDraftRequest,
    context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    prompt = _build_user_prompt(payload, context)
    request_payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "system": _build_system_prompt(),
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.2,
        },
    }

    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
            json=request_payload,
            timeout=OLLAMA_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama 요청 실패: {exc}",
        ) from exc

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama 응답 실패: {response.status_code} {response.text}",
        )

    response_payload = response.json()
    raw_text = response_payload.get("response", "")
    try:
        parsed = _extract_json_object(raw_text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama JSON 파싱 실패: {exc}",
        ) from exc

    return {
        "provider": "ollama",
        "model": OLLAMA_MODEL,
        "draft": parsed,
        "raw": response_payload,
    }


def generate_sequence_draft_with_openai(
    payload: SequenceAIDraftRequest,
    context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    openai_base_url, openai_model, openai_api_key, openai_timeout_seconds = _resolve_openai_api_settings()

    if not openai_api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY가 설정되지 않았습니다.",
        )

    started_at = time.perf_counter()
    request_payload = {
        "model": openai_model,
        "messages": [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": _build_user_prompt(payload, context)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    headers = {
        "Authorization": f"Bearer {openai_api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            f"{openai_base_url.rstrip('/')}/chat/completions",
            json=request_payload,
            headers=headers,
            timeout=openai_timeout_seconds,
            verify=_resolve_openai_verify_option(),
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI 요청 실패: {exc}",
        ) from exc

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI 응답 실패: {response.status_code} {response.text}",
        )

    response_payload = response.json()
    raw_text = (
        (((response_payload.get("choices") or [{}])[0]).get("message") or {}).get("content")
        or ""
    )
    try:
        parsed = _extract_json_object(raw_text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI JSON 파싱 실패: {exc}",
        ) from exc

    return {
        "provider": "openai",
        "model": openai_model,
        "draft": parsed,
        "raw": response_payload,
    }


def generate_sequence_chat_recommendations_with_openai(
    *,
    message: str,
    selected_parts: List[Dict[str, Any]],
    candidate_parts: List[Dict[str, Any]],
    candidate_processes: List[Dict[str, Any]],
    limit: int,
) -> Dict[str, Any]:
    openai_base_url, openai_model, openai_api_key, openai_timeout_seconds = _resolve_openai_api_settings()

    if not openai_api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY가 설정되지 않았습니다.",
        )

    request_body = {
        "message": str(message or "").strip(),
        "limit": int(limit),
        "selectedParts": selected_parts[:10],
        "candidateParts": candidate_parts[:12],
        "candidateProcesses": candidate_processes[:20],
    }

    request_payload = {
        "model": openai_model,
        "messages": [
            {"role": "system", "content": _build_chat_recommendation_system_prompt()},
            {"role": "user", "content": _build_chat_recommendation_user_prompt(request_body)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    headers = {
        "Authorization": f"Bearer {openai_api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            f"{openai_base_url.rstrip('/')}/chat/completions",
            json=request_payload,
            headers=headers,
            timeout=openai_timeout_seconds,
            verify=_resolve_openai_verify_option(),
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI 요청 실패: {exc}",
        ) from exc

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI 응답 실패: {response.status_code} {response.text}",
        )

    response_payload = response.json()
    raw_text = (
        (((response_payload.get("choices") or [{}])[0]).get("message") or {}).get("content")
        or ""
    )

    try:
        parsed = _extract_json_object(raw_text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI JSON 파싱 실패: {exc}",
        ) from exc

    return {
        "provider": "openai",
        "model": openai_model,
        "result": parsed,
        "raw": response_payload,
    }


def generate_sequence_chat_recommendations_with_ollama(
    *,
    message: str,
    selected_parts: List[Dict[str, Any]],
    candidate_parts: List[Dict[str, Any]],
    candidate_processes: List[Dict[str, Any]],
    limit: int,
) -> Dict[str, Any]:
    request_body = {
        "message": str(message or "").strip(),
        "limit": int(limit),
        "selectedParts": selected_parts[:10],
        "candidateParts": candidate_parts[:20],
        "candidateProcesses": candidate_processes[:30],
    }
    request_payload = {
        "model": OLLAMA_MODEL,
        "prompt": _build_chat_recommendation_user_prompt(request_body),
        "system": _build_chat_recommendation_system_prompt(),
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
        },
    }

    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
            json=request_payload,
            timeout=OLLAMA_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama 채팅 추천 요청 실패: {exc}",
        ) from exc

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama 채팅 추천 응답 실패: {response.status_code} {response.text}",
        )

    response_payload = response.json()
    raw_text = response_payload.get("response", "")
    try:
        parsed = _extract_json_object(raw_text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama 채팅 추천 JSON 파싱 실패: {exc}",
        ) from exc

    return {
        "provider": "ollama",
        "model": OLLAMA_MODEL,
        "result": parsed,
        "raw": response_payload,
    }


def generate_sequence_chat_recommendations(
    *,
    message: str,
    selected_parts: List[Dict[str, Any]],
    candidate_parts: List[Dict[str, Any]],
    candidate_processes: List[Dict[str, Any]],
    limit: int,
) -> Dict[str, Any]:
    provider = _resolve_sequence_ai_provider()
    if provider == "openai":
        return generate_sequence_chat_recommendations_with_openai(
            message=message,
            selected_parts=selected_parts,
            candidate_parts=candidate_parts,
            candidate_processes=candidate_processes,
            limit=limit,
        )
    return generate_sequence_chat_recommendations_with_ollama(
        message=message,
        selected_parts=selected_parts,
        candidate_parts=candidate_parts,
        candidate_processes=candidate_processes,
        limit=limit,
    )


def generate_sequence_draft(
    payload: SequenceAIDraftRequest,
    context: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    provider = _resolve_sequence_ai_provider()
    if provider == "finetuned_local":
        return generate_sequence_draft_with_local_model(payload, context)
    if provider == "openai":
        return generate_sequence_draft_with_openai(payload, context)
    return generate_sequence_draft_with_ollama(payload, context)
