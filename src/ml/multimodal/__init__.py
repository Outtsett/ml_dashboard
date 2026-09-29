"""The multimodal MNQ trading model (plan of record: docs/plans/2026-09-29-multimodal/).

Modules:
    holdout   the locked out-of-sample period: every loader refuses it unless the gate unlocks it
    lake_io   landing tables under s3://derived/<dataset>/recipe=<recipe>/table=<name>/ with manifest lines

Read ``docs/plans/2026-09-29-multimodal/CHECKPOINTS.md`` before changing anything here.
"""
