from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import torch

try:
    from peft import PeftModel
except ImportError:
    PeftModel = None  # type: ignore[assignment]

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
except ImportError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "transformers 패키지가 필요합니다. `pip install transformers` 후 다시 실행해주세요."
    ) from exc


SYSTEM_PROMPT = (
    "You are a manufacturing process planning assistant. "
    "Learn the order pattern from the provided source group label and source items. "
    "Return JSON only with groupLabel and sequence."
)

DEFAULT_LOCAL_MODEL_DIR = Path(__file__).resolve().parent / "models" / "Llama-3.1-8B-Instruct"


def _iter_case_files(case_dir: Path, split: str) -> List[Path]:
    paths = sorted(path for path in case_dir.glob("*.json") if path.is_file())
    if split == "all":
        return paths
    selected: List[Path] = []
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("split") == split:
            selected.append(path)
    return selected


def _resolve_model_source(model_name: str, model_path: str) -> str:
    candidate_path = Path(model_path).expanduser() if model_path else DEFAULT_LOCAL_MODEL_DIR
    if candidate_path.exists():
        return str(candidate_path)

    if model_path:
        raise SystemExit(
            f"지정한 로컬 모델 경로를 찾을 수 없습니다: {candidate_path}\n"
            "먼저 모델을 로컬 폴더에 받아둔 뒤 다시 실행해주세요."
        )

    if Path(model_name).exists():
        return str(Path(model_name))

    raise SystemExit(
        "로컬 Llama 모델 경로를 찾을 수 없습니다.\n"
        f"기본 경로: {DEFAULT_LOCAL_MODEL_DIR}\n"
        "모델을 로컬 폴더에 받아둔 뒤 `--model-path`로 지정하거나 기본 경로에 배치해주세요."
    )


def _render_chat(messages: List[Dict[str, str]]) -> str:
    lines: List[str] = []
    for message in messages:
        role = str(message.get("role") or "").strip().upper()
        lines.append(f"{role}: {message.get('content') or ''}")
    lines.append("ASSISTANT:")
    return "\n".join(lines)


def _build_user_content(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "bomId": payload.get("bomId"),
        "spec": payload.get("spec"),
        "sourceGroupLabel": (payload.get("input") or {}).get("sourceGroupLabel", ""),
        "sourceItems": (payload.get("input") or {}).get("sourceItems", []),
    }


def _build_prompt(tokenizer: Any, user_content: Dict[str, Any]) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user_content, ensure_ascii=False)},
    ]
    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    return _render_chat(messages)


def _extract_json_object(text: str) -> Dict[str, Any]:
    text = text.strip()
    if not text:
        return {}
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    snippet = text[start : end + 1]
    try:
        return json.loads(snippet)
    except json.JSONDecodeError:
        return {}


def _step_signature(step: Dict[str, Any]) -> Tuple[str, str]:
    step_type = str(step.get("type") or "").strip().upper()
    if step_type == "PROCESS":
        return ("PROCESS", str(step.get("processKey") or "").strip())
    return ("PART", str(step.get("nodeName") or "").strip())


def _score_case(target_sequence: List[Dict[str, Any]], predicted_sequence: List[Dict[str, Any]]) -> Dict[str, Any]:
    target_signatures = [_step_signature(step) for step in target_sequence]
    predicted_signatures = [_step_signature(step) for step in predicted_sequence]

    exact_match = target_signatures == predicted_signatures
    length_match = len(target_signatures) == len(predicted_signatures)

    compare_len = min(len(target_signatures), len(predicted_signatures))
    ordered_hits = sum(
        1 for index in range(compare_len) if target_signatures[index] == predicted_signatures[index]
    )
    order_accuracy = ordered_hits / max(len(target_signatures), 1)

    target_set = set(target_signatures)
    predicted_set = set(predicted_signatures)
    overlap = len(target_set & predicted_set)
    precision = overlap / max(len(predicted_set), 1)
    recall = overlap / max(len(target_set), 1)

    return {
        "exactMatch": exact_match,
        "lengthMatch": length_match,
        "orderAccuracy": order_accuracy,
        "setPrecision": precision,
        "setRecall": recall,
    }


def _load_model(model_name: str, model_path: str, adapter_path: Optional[str]) -> Tuple[Any, Any]:
    model_source = _resolve_model_source(model_name, model_path)
    tokenizer = AutoTokenizer.from_pretrained(adapter_path or model_source, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_source,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else None,
    )
    if adapter_path:
        if PeftModel is None:
            raise SystemExit("adapter 평가에는 peft 패키지가 필요합니다. `pip install peft` 후 다시 실행해주세요.")
        model = PeftModel.from_pretrained(model, adapter_path)
    model.eval()
    return tokenizer, model


def evaluate(args: argparse.Namespace) -> Dict[str, Any]:
    case_dir = Path(args.case_dir)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    tokenizer, model = _load_model(args.model_name, args.model_path, args.adapter_path)
    case_paths = _iter_case_files(case_dir, args.split)
    if args.limit:
        case_paths = case_paths[: args.limit]
    if not case_paths:
        raise SystemExit(f"평가할 케이스가 없습니다: {case_dir}")

    results: List[Dict[str, Any]] = []
    for case_path in case_paths:
        payload = json.loads(case_path.read_text(encoding="utf-8"))
        prompt = _build_prompt(tokenizer, _build_user_content(payload))
        encoded = tokenizer(prompt, return_tensors="pt")
        encoded = {key: value.to(model.device) for key, value in encoded.items()}
        with torch.no_grad():
            output_tokens = model.generate(
                **encoded,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                temperature=0.0,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )
        generated_tokens = output_tokens[0][encoded["input_ids"].shape[1] :]
        generated_text = tokenizer.decode(generated_tokens, skip_special_tokens=True)
        predicted_payload = _extract_json_object(generated_text)
        predicted_sequence = (predicted_payload.get("sequence") or []) if isinstance(predicted_payload, dict) else []
        target_sequence = ((payload.get("output") or {}).get("sequence") or [])
        scores = _score_case(target_sequence, predicted_sequence if isinstance(predicted_sequence, list) else [])
        results.append(
            {
                "caseId": payload.get("caseId"),
                "path": str(case_path),
                "target": target_sequence,
                "predicted": predicted_sequence,
                "rawText": generated_text,
                "scores": scores,
            }
        )

    summary = {
        "numCases": len(results),
        "exactMatchRate": sum(1 for item in results if item["scores"]["exactMatch"]) / len(results),
        "lengthMatchRate": sum(1 for item in results if item["scores"]["lengthMatch"]) / len(results),
        "avgOrderAccuracy": sum(item["scores"]["orderAccuracy"] for item in results) / len(results),
        "avgSetPrecision": sum(item["scores"]["setPrecision"] for item in results) / len(results),
        "avgSetRecall": sum(item["scores"]["setRecall"] for item in results) / len(results),
    }
    payload = {"summary": summary, "results": results}
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def parse_args() -> argparse.Namespace:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-name", default="meta-llama/Llama-3.1-8B-Instruct")
    parser.add_argument("--model-path", default=str(DEFAULT_LOCAL_MODEL_DIR))
    parser.add_argument("--adapter-path", default=None)
    parser.add_argument("--case-dir", default=str(base_dir / "cases"))
    parser.add_argument("--split", default="valid", choices=["train", "valid", "all"])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--max-new-tokens", type=int, default=512)
    parser.add_argument("--output", default=str(base_dir / "outputs" / "eval_results.json"))
    return parser.parse_args()


def main() -> None:
    result = evaluate(parse_args())
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
