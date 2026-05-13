from __future__ import annotations

import argparse
import json
import inspect
from pathlib import Path
from typing import Any, Dict, List, Optional

import torch
from torch.utils.data import Dataset

try:
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
except ImportError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "peft 패키지가 필요합니다. `pip install peft` 후 다시 실행해주세요."
    ) from exc

try:
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        Trainer,
        TrainingArguments,
    )
except ImportError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "transformers 패키지가 필요합니다. `pip install transformers` 후 다시 실행해주세요."
    ) from exc


DEFAULT_LOCAL_MODEL_DIR = Path(__file__).resolve().parent / "models" / "Llama-3.1-8B-Instruct"


def _load_jsonl(path: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    if not path.exists():
        return records
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def _resolve_model_source(model_name: str, model_path: str) -> str:
    candidate_path = Path(model_path).expanduser() if model_path else DEFAULT_LOCAL_MODEL_DIR
    if candidate_path.exists():
        return str(candidate_path)

    if model_path:
        raise SystemExit(
            f"지정한 로컬 모델 경로를 찾을 수 없습니다: {candidate_path}\n"
            f"먼저 모델을 해당 경로에 받아둔 뒤 다시 실행해주세요."
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
        content = str(message.get("content") or "")
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _render_prompt(messages: List[Dict[str, str]]) -> str:
    lines: List[str] = []
    for message in messages:
        role = str(message.get("role") or "").strip().upper()
        content = str(message.get("content") or "")
        lines.append(f"{role}: {content}")
    lines.append("ASSISTANT:")
    return "\n".join(lines)


def _build_text_pair(tokenizer: Any, messages: List[Dict[str, str]]) -> Dict[str, str]:
    if not messages or str(messages[-1].get("role") or "").strip().lower() != "assistant":
        raise ValueError("마지막 메시지는 assistant여야 합니다.")

    prompt_messages = messages[:-1]
    if hasattr(tokenizer, "apply_chat_template"):
        prompt_text = tokenizer.apply_chat_template(
            prompt_messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        full_text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
    else:
        prompt_text = _render_prompt(prompt_messages)
        full_text = _render_chat(messages)

    eos_token = getattr(tokenizer, "eos_token", None)
    if eos_token and not full_text.endswith(eos_token):
        full_text = f"{full_text}{eos_token}"

    return {"prompt_text": prompt_text, "full_text": full_text}


def _format_record(record: Dict[str, Any], tokenizer: Any, max_length: int) -> Dict[str, torch.Tensor]:
    messages = record.get("messages", []) or []
    rendered = _build_text_pair(tokenizer, messages)

    prompt_encoded = tokenizer(
        rendered["prompt_text"],
        truncation=True,
        max_length=max_length,
        padding=False,
    )
    full_encoded = tokenizer(
        rendered["full_text"],
        truncation=True,
        max_length=max_length,
        padding=False,
    )

    input_ids = full_encoded["input_ids"]
    attention_mask = full_encoded["attention_mask"]
    labels = list(input_ids)
    prompt_len = min(len(prompt_encoded["input_ids"]), len(labels))
    for index in range(prompt_len):
        labels[index] = -100

    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "attention_mask": torch.tensor(attention_mask, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
    }


class JsonlChatDataset(Dataset):
    def __init__(self, path: Path, tokenizer: Any, max_length: int) -> None:
        self.records = _load_jsonl(path)
        self.samples = [_format_record(record, tokenizer, max_length) for record in self.records]

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> Dict[str, torch.Tensor]:
        return self.samples[index]


class SupervisedDataCollator:
    def __init__(self, tokenizer: Any) -> None:
        self.tokenizer = tokenizer

    def __call__(self, features: List[Dict[str, torch.Tensor]]) -> Dict[str, torch.Tensor]:
        input_ids = [feature["input_ids"] for feature in features]
        attention_mask = [feature["attention_mask"] for feature in features]
        labels = [feature["labels"] for feature in features]

        batch_input_ids = torch.nn.utils.rnn.pad_sequence(
            input_ids,
            batch_first=True,
            padding_value=self.tokenizer.pad_token_id,
        )
        batch_attention_mask = torch.nn.utils.rnn.pad_sequence(
            attention_mask,
            batch_first=True,
            padding_value=0,
        )
        batch_labels = torch.nn.utils.rnn.pad_sequence(
            labels,
            batch_first=True,
            padding_value=-100,
        )
        batch_labels = batch_labels.masked_fill(batch_attention_mask == 0, -100)

        return {
            "input_ids": batch_input_ids,
            "attention_mask": batch_attention_mask,
            "labels": batch_labels,
        }


def _maybe_build_quant_config(use_qlora: bool) -> Optional[BitsAndBytesConfig]:
    if not use_qlora:
        return None
    try:
        import bitsandbytes  # noqa: F401
    except ImportError:
        return None
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    )


def build_model(
    model_name: str,
    lora_r: int,
    lora_alpha: int,
    lora_dropout: float,
    use_qlora: bool,
) -> Any:
    quantization_config = _maybe_build_quant_config(use_qlora)
    model_kwargs: Dict[str, Any] = {
        "torch_dtype": torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    }
    if torch.cuda.is_available():
        model_kwargs["device_map"] = "auto"
    if quantization_config is not None:
        model_kwargs["quantization_config"] = quantization_config

    model = AutoModelForCausalLM.from_pretrained(model_name, **model_kwargs)
    if quantization_config is not None:
        model = prepare_model_for_kbit_training(model)
    model.gradient_checkpointing_enable()

    lora_config = LoraConfig(
        r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    )
    return get_peft_model(model, lora_config)


def _build_training_arguments(
    args: argparse.Namespace,
    output_dir: Path,
    has_valid: bool,
    use_qlora: bool,
) -> TrainingArguments:
    optim_name = "paged_adamw_8bit" if use_qlora else "adamw_torch"
    kwargs: Dict[str, Any] = {
        "output_dir": str(output_dir),
        "overwrite_output_dir": True,
        "num_train_epochs": args.num_epochs,
        "per_device_train_batch_size": args.batch_size,
        "per_device_eval_batch_size": args.eval_batch_size,
        "gradient_accumulation_steps": args.gradient_accumulation_steps,
        "learning_rate": args.learning_rate,
        "lr_scheduler_type": "cosine",
        "warmup_ratio": args.warmup_ratio,
        "logging_steps": args.logging_steps,
        "save_strategy": "epoch",
        "load_best_model_at_end": has_valid,
        "metric_for_best_model": "eval_loss" if has_valid else None,
        "greater_is_better": False if has_valid else None,
        "save_total_limit": 2,
        "bf16": torch.cuda.is_available(),
        "fp16": False,
        "report_to": [],
        "remove_unused_columns": False,
        "gradient_checkpointing": True,
        "optim": optim_name,
    }
    signature = inspect.signature(TrainingArguments.__init__)
    if "evaluation_strategy" in signature.parameters:
        kwargs["evaluation_strategy"] = "epoch" if has_valid else "no"
    elif "eval_strategy" in signature.parameters:
        kwargs["eval_strategy"] = "epoch" if has_valid else "no"

    return TrainingArguments(**kwargs)


def train(args: argparse.Namespace) -> None:
    train_path = Path(args.train_file)
    valid_path = Path(args.valid_file)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    model_source = _resolve_model_source(args.model_name, args.model_path)

    tokenizer = AutoTokenizer.from_pretrained(model_source, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    train_dataset = JsonlChatDataset(train_path, tokenizer, args.max_length)
    valid_dataset = JsonlChatDataset(valid_path, tokenizer, args.max_length) if valid_path.exists() else None
    has_valid = valid_dataset is not None and len(valid_dataset) > 0

    if len(train_dataset) == 0:
        raise SystemExit(f"학습 데이터가 비어 있습니다: {train_path}")

    actual_use_qlora = args.use_qlora and _maybe_build_quant_config(True) is not None

    model = build_model(
        model_source,
        lora_r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        use_qlora=actual_use_qlora,
    )
    model.config.use_cache = False

    training_args = _build_training_arguments(
        args=args,
        output_dir=output_dir,
        has_valid=has_valid,
        use_qlora=actual_use_qlora,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=valid_dataset if has_valid else None,
        data_collator=SupervisedDataCollator(tokenizer),
    )
    trainer.train(resume_from_checkpoint=args.resume_from_checkpoint or None)
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))


def parse_args() -> argparse.Namespace:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-name", default="meta-llama/Llama-3.1-8B-Instruct")
    parser.add_argument("--model-path", default=str(DEFAULT_LOCAL_MODEL_DIR))
    parser.add_argument("--train-file", default=str(base_dir / "jsonl" / "train.jsonl"))
    parser.add_argument("--valid-file", default=str(base_dir / "jsonl" / "valid.jsonl"))
    parser.add_argument("--output-dir", default=str(base_dir / "outputs" / "lora"))
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--num-epochs", type=float, default=3.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--eval-batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--warmup-ratio", type=float, default=0.03)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--lora-r", type=int, default=32)
    parser.add_argument("--lora-alpha", type=int, default=64)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--use-qlora", action="store_true")
    parser.add_argument("--resume-from-checkpoint", default="")
    return parser.parse_args()


def main() -> None:
    train(parse_args())


if __name__ == "__main__":
    main()
