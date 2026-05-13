# Sequence Fine-Tuning Dataset

This folder stores curated sequence-planning training data.

## Folder layout

- `cases/`
  - One reviewed training case per JSON file.
  - These are the source-of-truth files for dataset curation.
- `jsonl/`
  - Built output files for model training.
  - Generated from `cases/` by `build_finetune_dataset.py`.
- `templates/`
  - Reference files and starter templates.

## Recommended workflow

1. Start from a reviewed `sequence.json`.
2. Convert it into a case stub with `sequence_to_case.py`.
3. Review `input.sourceGroupLabel` and `input.sourceItems`.
4. Review and fix `output.sequence`.
5. Run `split_cases.py` to assign `train` / `valid`.
6. Run `build_finetune_dataset.py`.
7. Train with `train_lora.py`.
8. Evaluate with `evaluate_sequence_model.py`.

## Training JSONL format

Each JSONL line is a chat-style record:

```json
{
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "{...sourceGroupLabel, sourceItems...}"},
    {"role": "assistant", "content": "{...output json...}"}
  ],
  "metadata": {
    "caseId": "case-001",
    "bomId": "example-bom",
    "spec": "HL_STD_LHD_LD",
    "sourceType": "excel_sequence"
  }
}
```

## Conversion rules

- `output.sequence` is the training target.
- `input.sourceItems` is the simplified order-learning input.
- Keep only sequence-relevant fields in the assistant target:
  - `groupLabel`
  - `sequence`
- Use reviewed order only.
- A `PART` step must contain `nodeName`.
- A `PROCESS` step must contain `processKey`.
- Put explanatory text in `reason` only when it materially helps supervision.
- Prefer concise, stable labels over verbose descriptions.

## Training

Recommended split first:

```powershell
cd backend/finetune_sequence
python split_cases.py --mode source --valid-ratio 0.1
python build_finetune_dataset.py
```

- `--mode source`
  - 같은 원본 `sourcePath`에서 나온 케이스가 train/valid에 섞이지 않게 분할합니다.
- `--mode bom`
  - 같은 `bomId` 기준으로 분할합니다.
- `--mode case`
  - 케이스 단위 랜덤 분할입니다. 누수 가능성이 있어 기본 추천은 아닙니다.

Example:

```powershell
cd backend/finetune_sequence
python train_lora.py --model-path models/Llama-3.1-8B-Instruct --use-qlora --output-dir outputs/lora
```

- Input: `jsonl/train.jsonl`
- Validation: `jsonl/valid.jsonl`
- Output: LoRA adapter under `outputs/lora`
- Base model:
  - Place the local model under `models/Llama-3.1-8B-Instruct`
  - Or pass another local path with `--model-path`
- Recommended:
  - `--use-qlora`
  - assistant 응답 구간만 loss 계산
  - cosine scheduler + gradient checkpointing

## Evaluation

Example:

```powershell
cd backend/finetune_sequence
python evaluate_sequence_model.py --model-path models/Llama-3.1-8B-Instruct --adapter-path outputs/lora --split valid
```

- Output report: `outputs/eval_results.json`
- Main metrics:
  - `exactMatchRate`
  - `lengthMatchRate`
  - `avgOrderAccuracy`
  - `avgSetPrecision`
  - `avgSetRecall`
