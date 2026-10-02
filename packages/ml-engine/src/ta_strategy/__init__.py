"""TA-indicator strategy scored against a goal of 600 MNQ ticks per session day.

Every round of the study is a grid in ``packages/config/ta_strategy_rounds.json``;
``main.py`` runs one round, lands its tables in the lake under
``s3://derived/ta_strategy_600_ticks/recipe=<round>/`` and streams progress
through the stdout protocol. ``docs/ta-strategy-600-ticks.md`` is the reference.
"""
