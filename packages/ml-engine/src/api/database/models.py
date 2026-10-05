from typing import Optional
import enum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, Integer, REAL, Text, text
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(AsyncAttrs, DeclarativeBase):
    pass


class AgentRunsAgentId(str, enum.Enum):
    FEATURE_CURATOR = 'feature-curator'
    ARCH_DESIGNER = 'arch-designer'
    HPO_STRATEGIST = 'hpo-strategist'
    EVAL_REVIEWER = 'eval-reviewer'


class AgentRunsStatus(str, enum.Enum):
    QUEUED = 'queued'
    RUNNING = 'running'
    COMPLETED = 'completed'
    FAILED = 'failed'
    CANCELLED = 'cancelled'


class DeploymentsMode(str, enum.Enum):
    SHADOW = 'shadow'
    PAPER = 'paper'
    LIVE = 'live'


class DeploymentsStatus(str, enum.Enum):
    RUNNING = 'running'
    PAUSED = 'paused'
    STOPPED = 'stopped'
    FAILED = 'failed'


class ModelVersionsStatus(str, enum.Enum):
    CANDIDATE = 'candidate'
    SHADOW = 'shadow'
    PAPER = 'paper'
    LIVE = 'live'
    RETIRED = 'retired'


class PromotionGatesComparator(str, enum.Enum):
    __ = '>='
    __ = '<='
    _ = '>'
    _ = '<'
    __ = '=='
    __ = '!='


class AgentRuns(Base):
    __tablename__ = 'agent_runs'
    __table_args__ = (
        CheckConstraint("agent_id IN ('feature-curator','arch-designer','hpo-strategist','eval-reviewer')"),
        CheckConstraint("status IN ('queued','running','completed','failed','cancelled')"),
        Index('idx_agent_runs_agent_status', 'agent_id', 'status'),
        Index('idx_agent_runs_context_hash', 'context_blob_hash'),
        Index('idx_agent_runs_requested_at', 'requested_at')
    )

    agent_id: Mapped[AgentRunsAgentId] = mapped_column(Enum(AgentRunsAgentId, values_callable=lambda cls: [member.value for member in cls]), nullable=False)
    status: Mapped[AgentRunsStatus] = mapped_column(Enum(AgentRunsStatus, values_callable=lambda cls: [member.value for member in cls]), nullable=False)
    context_blob: Mapped[str] = mapped_column(Text, nullable=False)
    context_blob_hash: Mapped[str] = mapped_column(Text, nullable=False)
    requested_at: Mapped[str] = mapped_column(Text, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(Text, primary_key=True)
    started_at: Mapped[Optional[str]] = mapped_column(Text)
    completed_at: Mapped[Optional[str]] = mapped_column(Text)
    output: Mapped[Optional[str]] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
    cancelled_reason: Mapped[Optional[str]] = mapped_column(Text)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    token_usage: Mapped[Optional[str]] = mapped_column(Text)


class BrokerConfigs(Base):
    __tablename__ = 'broker_configs'
    __table_args__ = (
        Index('broker_configs_asset_type_idx', 'asset_type'),
        Index('broker_configs_name_idx', 'name'),
        Index('broker_configs_name_unique', 'name', unique=True)
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    broker: Mapped[str] = mapped_column(Text, nullable=False)
    asset_type: Mapped[str] = mapped_column(Text, nullable=False)
    commission_type: Mapped[str] = mapped_column(Text, nullable=False)
    spread_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'variable'"))
    slippage_model: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'fixed'"))
    margin_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'fixed'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    commission_per_lot: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    commission_per_side: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    commission_per_round_turn: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    typical_spread_pips: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    slippage_ticks: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    default_margin: Mapped[Optional[float]] = mapped_column(REAL)
    config: Mapped[Optional[str]] = mapped_column(Text)
    is_default: Mapped[Optional[int]] = mapped_column(Integer, server_default=text('0'))

    backtest_runs: Mapped[list['BacktestRuns']] = relationship('BacktestRuns', back_populates='broker_config')


class CoherenceSnapshots(Base):
    __tablename__ = 'coherence_snapshots'
    __table_args__ = (
        Index('coherence_snapshots_symbol_idx', 'symbol'),
        Index('coherence_snapshots_ts_idx', 'timestamp')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    model_correlations: Mapped[str] = mapped_column(Text, nullable=False)
    agreement_matrix: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    ensemble_signal: Mapped[Optional[str]] = mapped_column(Text)
    ensemble_confidence: Mapped[Optional[float]] = mapped_column(REAL)
    divergence_score: Mapped[Optional[float]] = mapped_column(REAL)


class EnsembleConfigs(Base):
    __tablename__ = 'ensemble_configs'
    __table_args__ = (
        Index('ensemble_configs_name_idx', 'name'),
        Index('ensemble_configs_name_unique', 'name', unique=True),
        Index('ensemble_configs_status_idx', 'status')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    model_ids: Mapped[str] = mapped_column(Text, nullable=False)
    aggregation_method: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'vote'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    weights: Mapped[Optional[str]] = mapped_column(Text)
    confidence_threshold: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0.5'))
    unanimity_required: Mapped[Optional[int]] = mapped_column(Integer, server_default=text('0'))


class EvaluationResults(Base):
    __tablename__ = 'evaluation_results'
    __table_args__ = (
        Index('er_session_idx', 'session_id'),
        Index('er_session_stage_idx', 'session_id', 'stage', 'test_name')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    stage: Mapped[str] = mapped_column(Text, nullable=False)
    test_name: Mapped[str] = mapped_column(Text, nullable=False)
    computed_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    test_value: Mapped[Optional[float]] = mapped_column(REAL)
    test_passed: Mapped[Optional[int]] = mapped_column(Integer)
    p_value: Mapped[Optional[float]] = mapped_column(REAL)
    details: Mapped[Optional[str]] = mapped_column(Text)


class Events(Base):
    __tablename__ = 'events'
    __table_args__ = (
        Index('events_stream_position_unique', 'stream_id', 'stream_position'),
        Index('idx_events_created', 'created_at'),
        Index('idx_events_stream', 'stream_id', 'stream_position'),
        Index('idx_events_type', 'type')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stream_id: Mapped[str] = mapped_column(Text, nullable=False)
    stream_position: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    data: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_: Mapped[str] = mapped_column('metadata', Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("datetime('now')"))


class Experiments(Base):
    __tablename__ = 'experiments'
    __table_args__ = (
        Index('idx_experiments_catalog', 'catalog_id'),
        Index('idx_experiments_created_at', 'created_at'),
        Index('idx_experiments_status', 'status')
    )

    experiment_id: Mapped[str] = mapped_column(Text, primary_key=True)
    catalog_id: Mapped[str] = mapped_column(Text, nullable=False)
    runner_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    name: Mapped[Optional[str]] = mapped_column(Text)
    symbol: Mapped[Optional[str]] = mapped_column(Text)
    timeframe: Mapped[Optional[str]] = mapped_column(Text)
    finalized_at: Mapped[Optional[str]] = mapped_column(Text)

    runs: Mapped[list['Runs']] = relationship('Runs', back_populates='experiment')


class FeatureImportance(Base):
    __tablename__ = 'feature_importance'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    feature_name: Mapped[str] = mapped_column(Text, nullable=False)
    importance: Mapped[float] = mapped_column(REAL, nullable=False)
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    category: Mapped[Optional[str]] = mapped_column(Text)


class FeatureSets(Base):
    __tablename__ = 'feature_sets'
    __table_args__ = (
        Index('feature_sets_name_idx', 'name'),
        Index('feature_sets_name_unique', 'name', unique=True)
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    features: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    normalization: Mapped[Optional[str]] = mapped_column(Text)
    lag_periods: Mapped[Optional[str]] = mapped_column(Text)
    technical_indicators: Mapped[Optional[str]] = mapped_column(Text)
    symbols: Mapped[Optional[str]] = mapped_column(Text)
    timeframe: Mapped[Optional[str]] = mapped_column(Text)
    lookback_bars: Mapped[Optional[int]] = mapped_column(Integer, server_default=text('100'))


class HpoSearchSpaces(Base):
    __tablename__ = 'hpo_search_spaces'
    __table_args__ = (
        Index('hpo_ss_model_type_idx', 'model_type'),
        Index('hpo_ss_name_idx', 'name')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    model_type: Mapped[str] = mapped_column(Text, nullable=False)
    search_space: Mapped[str] = mapped_column(Text, nullable=False)
    times_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    optimizer_type: Mapped[Optional[str]] = mapped_column(Text)
    optimizer_config: Mapped[Optional[str]] = mapped_column(Text)
    best_score_ever: Mapped[Optional[float]] = mapped_column(REAL)


class HpoSessions(Base):
    __tablename__ = 'hpo_sessions'
    __table_args__ = (
        Index('hpo_s_model_type_idx', 'model_type'),
        Index('hpo_s_optimizer_type_idx', 'optimizer_type'),
        Index('hpo_s_session_id_idx', 'session_id'),
        Index('hpo_s_status_idx', 'status'),
        Index('hpo_s_symbol_idx', 'symbol'),
        Index('hpo_sessions_session_id_unique', 'session_id', unique=True)
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, nullable=False)
    model_type: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    timeframe: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    optimizer_type: Mapped[str] = mapped_column(Text, nullable=False)
    optimizer_config: Mapped[str] = mapped_column(Text, nullable=False)
    objective_metric: Mapped[str] = mapped_column(Text, nullable=False)
    objective_direction: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'minimize'"))
    search_space: Mapped[str] = mapped_column(Text, nullable=False)
    total_trials: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    completed_trials: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    pruned_trials: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    failed_trials: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    started_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    fixed_hyperparameters: Mapped[Optional[str]] = mapped_column(Text)
    best_trial_id: Mapped[Optional[int]] = mapped_column(Integer)
    best_score: Mapped[Optional[float]] = mapped_column(REAL)
    best_params: Mapped[Optional[str]] = mapped_column(Text)
    date_range_start: Mapped[Optional[str]] = mapped_column(Text)
    date_range_end: Mapped[Optional[str]] = mapped_column(Text)
    max_bars: Mapped[Optional[int]] = mapped_column(Integer)
    feature_categories: Mapped[Optional[str]] = mapped_column(Text)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    completed_at: Mapped[Optional[int]] = mapped_column(Integer)
    elapsed_sec: Mapped[Optional[float]] = mapped_column(REAL)


class HpoTrials(Base):
    __tablename__ = 'hpo_trials'
    __table_args__ = (
        Index('hpo_t_fold_idx', 'fold_index'),
        Index('hpo_t_score_idx', 'score'),
        Index('hpo_t_session_id_idx', 'session_id'),
        Index('hpo_t_session_trial_idx', 'session_id', 'trial_id'),
        Index('hpo_t_status_idx', 'status')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, nullable=False)
    trial_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'running'"))
    params: Mapped[str] = mapped_column(Text, nullable=False)
    pruned: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    started_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    score: Mapped[Optional[float]] = mapped_column(REAL)
    metrics: Mapped[Optional[str]] = mapped_column(Text)
    pruned_at_step: Mapped[Optional[int]] = mapped_column(Integer)
    error: Mapped[Optional[str]] = mapped_column(Text)
    duration_sec: Mapped[Optional[float]] = mapped_column(REAL)
    iteration_history: Mapped[Optional[str]] = mapped_column(Text)
    model_path: Mapped[Optional[str]] = mapped_column(Text)
    trained_model_id: Mapped[Optional[str]] = mapped_column(Text)
    completed_at: Mapped[Optional[int]] = mapped_column(Integer)
    intermediate_values: Mapped[Optional[str]] = mapped_column(Text)
    fold_index: Mapped[Optional[int]] = mapped_column(Integer)


class IngestedFiles(Base):
    __tablename__ = 'ingested_files'
    __table_args__ = (
        Index('ingested_files_file_path_idx', 'file_path'),
        Index('ingested_files_file_path_unique', 'file_path', unique=True),
        Index('ingested_files_symbol_idx', 'symbol')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    ingested_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    file_hash: Mapped[Optional[str]] = mapped_column(Text)
    file_size: Mapped[Optional[int]] = mapped_column(Integer)
    row_count: Mapped[Optional[int]] = mapped_column(Integer)
    symbol: Mapped[Optional[str]] = mapped_column(Text)
    ts_min: Mapped[Optional[int]] = mapped_column(Integer)
    ts_max: Mapped[Optional[int]] = mapped_column(Integer)


class Instruments(Base):
    __tablename__ = 'instruments'
    __table_args__ = (
        Index('instruments_asset_type_idx', 'asset_type'),
        Index('instruments_symbol_idx', 'symbol'),
        Index('instruments_symbol_unique', 'symbol', unique=True)
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    asset_type: Mapped[str] = mapped_column(Text, nullable=False)
    tick_size: Mapped[float] = mapped_column(REAL, nullable=False)
    tick_value: Mapped[float] = mapped_column(REAL, nullable=False)
    point_value: Mapped[float] = mapped_column(REAL, nullable=False)
    contract_size: Mapped[float] = mapped_column(REAL, nullable=False, server_default=text('1'))
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'USD'"))
    decimal_places: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('2'))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    exchange: Mapped[Optional[str]] = mapped_column(Text)
    margin_requirement: Mapped[Optional[float]] = mapped_column(REAL)
    trading_hours: Mapped[Optional[str]] = mapped_column(Text)
    pip_size: Mapped[Optional[float]] = mapped_column(REAL)
    contract_months: Mapped[Optional[str]] = mapped_column(Text)


class LossHistory(Base):
    __tablename__ = 'loss_history'
    __table_args__ = (
        Index('session_epoch_idx', 'session_id', 'epoch'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    epoch: Mapped[int] = mapped_column(Integer, nullable=False)
    loss: Mapped[float] = mapped_column(REAL, nullable=False)
    val_loss: Mapped[float] = mapped_column(REAL, nullable=False)
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))


class MarketRegimes(Base):
    __tablename__ = 'market_regimes'
    __table_args__ = (
        Index('market_regimes_name_idx', 'name'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    volatility_level: Mapped[Optional[str]] = mapped_column(Text)
    trend_direction: Mapped[Optional[str]] = mapped_column(Text)
    characteristics: Mapped[Optional[str]] = mapped_column(Text)
    detection_rules: Mapped[Optional[str]] = mapped_column(Text)

    regime_history: Mapped[list['RegimeHistory']] = relationship('RegimeHistory', back_populates='regime')


class MlModels(Base):
    __tablename__ = 'ml_models'
    __table_args__ = (
        Index('ml_models_architecture_idx', 'architecture'),
        Index('ml_models_category_idx', 'category'),
        Index('ml_models_name_version_idx', 'name', 'version'),
        Index('ml_models_status_idx', 'status'),
        Index('ml_models_subcategory_idx', 'subcategory')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'1.0.0'"))
    architecture: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'draft'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    category: Mapped[Optional[str]] = mapped_column(Text)
    subcategory: Mapped[Optional[str]] = mapped_column(Text)
    description: Mapped[Optional[str]] = mapped_column(Text)
    hyperparameters: Mapped[Optional[str]] = mapped_column(Text)
    feature_set_id: Mapped[Optional[int]] = mapped_column(Integer)
    training_data_start: Mapped[Optional[int]] = mapped_column(Integer)
    training_data_end: Mapped[Optional[int]] = mapped_column(Integer)
    validation_split: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0.2'))
    target_column: Mapped[Optional[str]] = mapped_column(Text)
    target_horizon: Mapped[Optional[int]] = mapped_column(Integer)
    metrics: Mapped[Optional[str]] = mapped_column(Text)

    backtest_runs: Mapped[list['BacktestRuns']] = relationship('BacktestRuns', back_populates='model')
    generated_labels: Mapped[list['GeneratedLabels']] = relationship('GeneratedLabels', back_populates='model')
    model_outputs: Mapped[list['ModelOutputs']] = relationship('ModelOutputs', back_populates='model')
    strategies: Mapped[list['Strategies']] = relationship('Strategies', back_populates='model')


class ModelCheckpoints(Base):
    __tablename__ = 'model_checkpoints'
    __table_args__ = (
        Index('mc_active_idx', 'is_active'),
        Index('mc_created_at_idx', 'created_at'),
        Index('mc_model_type_idx', 'model_type'),
        Index('mc_primary_metric_idx', 'primary_metric'),
        Index('mc_symbol_idx', 'symbol'),
        Index('mc_symbol_tf_idx', 'symbol', 'timeframe'),
        Index('model_checkpoints_model_id_unique', 'model_id', unique=True)
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_id: Mapped[str] = mapped_column(Text, nullable=False)
    model_type: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    timeframe: Mapped[str] = mapped_column(Text, nullable=False)
    diagnostics_json: Mapped[str] = mapped_column(Text, nullable=False)
    checkpoint_path: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    diagnostics_path: Mapped[Optional[str]] = mapped_column(Text)
    primary_metric: Mapped[Optional[float]] = mapped_column(REAL)
    primary_metric_name: Mapped[Optional[str]] = mapped_column(Text)
    param_count: Mapped[Optional[int]] = mapped_column(Integer)
    training_duration_sec: Mapped[Optional[float]] = mapped_column(REAL)
    n_bars_train: Mapped[Optional[int]] = mapped_column(Integer)
    n_bars_val: Mapped[Optional[int]] = mapped_column(Integer)
    session_id: Mapped[Optional[int]] = mapped_column(Integer)


class ModelStateSnapshots(Base):
    __tablename__ = 'model_state_snapshots'
    __table_args__ = (
        Index('mss_session_idx', 'session_id'),
        Index('mss_session_iteration_idx', 'session_id', 'iteration')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    iteration: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))


class ModelVersions(Base):
    __tablename__ = 'model_versions'
    __table_args__ = (
        CheckConstraint("status IN ('candidate','shadow','paper','live','retired')"),
        Index('idx_model_versions_artifact', 'model_artifact_path', unique=True),
        Index('idx_model_versions_catalog', 'catalog_id'),
        Index('idx_model_versions_data_hash', 'data_hash'),
        Index('idx_model_versions_status', 'status'),
        Index('idx_model_versions_symbol_tf', 'symbol', 'timeframe'),
        Index('idx_model_versions_trained_at', 'trained_at')
    )

    catalog_id: Mapped[str] = mapped_column(Text, nullable=False)
    runner_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[ModelVersionsStatus] = mapped_column(Enum(ModelVersionsStatus, values_callable=lambda cls: [member.value for member in cls]), nullable=False)
    data_hash: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    timeframe: Mapped[str] = mapped_column(Text, nullable=False)
    date_range_start: Mapped[str] = mapped_column(Text, nullable=False)
    date_range_end: Mapped[str] = mapped_column(Text, nullable=False)
    feature_pipeline: Mapped[str] = mapped_column(Text, nullable=False)
    label_config: Mapped[str] = mapped_column(Text, nullable=False)
    hyperparameters: Mapped[str] = mapped_column(Text, nullable=False)
    model_artifact_path: Mapped[str] = mapped_column(Text, nullable=False)
    diagnostics_path: Mapped[str] = mapped_column(Text, nullable=False)
    metrics_summary: Mapped[str] = mapped_column(Text, nullable=False)
    trained_at: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    version_id: Mapped[Optional[int]] = mapped_column(Integer, primary_key=True)
    walk_forward_config: Mapped[Optional[str]] = mapped_column(Text)
    hpo_study_id: Mapped[Optional[str]] = mapped_column(Text)
    promoted_at: Mapped[Optional[str]] = mapped_column(Text)
    retired_at: Mapped[Optional[str]] = mapped_column(Text)
    parent_version_id: Mapped[Optional[int]] = mapped_column(ForeignKey('model_versions.version_id'))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    parent_version: Mapped[Optional['ModelVersions']] = relationship('ModelVersions', remote_side=[version_id], back_populates='parent_version_reverse')
    parent_version_reverse: Mapped[list['ModelVersions']] = relationship('ModelVersions', remote_side=[parent_version_id], back_populates='parent_version')
    deployments: Mapped[list['Deployments']] = relationship('Deployments', back_populates='version')


class MwFileStates(Base):
    __tablename__ = 'mw_file_states'
    __table_args__ = (
        Index('mw_file_states_file_path_unique', 'file_path', unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    last_modified: Mapped[float] = mapped_column(REAL, nullable=False)
    rows_imported: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    symbol: Mapped[Optional[str]] = mapped_column(Text)
    timeframe: Mapped[Optional[str]] = mapped_column(Text)


class NewsArticles(Base):
    __tablename__ = 'news_articles'
    __table_args__ = (
        Index('news_external_id_idx', 'external_id'),
        Index('news_published_at_idx', 'published_at'),
        Index('news_sentiment_idx', 'sentiment_score'),
        Index('news_source_idx', 'source')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[int] = mapped_column(Integer, nullable=False)
    fetched_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    summary: Mapped[Optional[str]] = mapped_column(Text)
    content: Mapped[Optional[str]] = mapped_column(Text)
    source_url: Mapped[Optional[str]] = mapped_column(Text)
    sentiment_score: Mapped[Optional[float]] = mapped_column(REAL)
    sentiment_label: Mapped[Optional[str]] = mapped_column(Text)
    sentiment_confidence: Mapped[Optional[float]] = mapped_column(REAL)
    relevance_score: Mapped[Optional[float]] = mapped_column(REAL)
    category: Mapped[Optional[str]] = mapped_column(Text)
    external_id: Mapped[Optional[str]] = mapped_column(Text)

    news_symbols: Mapped[list['NewsSymbols']] = relationship('NewsSymbols', back_populates='news')


class PredictionLog(Base):
    __tablename__ = 'prediction_log'
    __table_args__ = (
        Index('pl_checkpoint_idx', 'checkpoint_id'),
        Index('pl_model_id_idx', 'model_id'),
        Index('pl_predicted_class_idx', 'predicted_class'),
        Index('pl_split_idx', 'split_type'),
        Index('pl_symbol_ts_idx', 'symbol', 'bar_timestamp')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    checkpoint_id: Mapped[int] = mapped_column(Integer, nullable=False)
    model_id: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    bar_timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_class: Mapped[int] = mapped_column(Integer, nullable=False)
    split_type: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'oos'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    actual_class: Mapped[Optional[int]] = mapped_column(Integer)
    confidence: Mapped[Optional[float]] = mapped_column(REAL)
    probabilities: Mapped[Optional[str]] = mapped_column(Text)
    realized_return: Mapped[Optional[float]] = mapped_column(REAL)
    exit_bars: Mapped[Optional[int]] = mapped_column(Integer)
    barrier_hit: Mapped[Optional[str]] = mapped_column(Text)
    fold_index: Mapped[Optional[int]] = mapped_column(Integer)

class PromotionGates(Base):
    __tablename__ = 'promotion_gates'
    __table_args__ = (
        CheckConstraint("comparator IN ('>=','<=','>','<','==','!=')"),
        Index('idx_promotion_gates_transition', 'from_status', 'to_status')
    )

    from_status: Mapped[str] = mapped_column(Text, nullable=False)
    to_status: Mapped[str] = mapped_column(Text, nullable=False)
    metric: Mapped[str] = mapped_column(Text, nullable=False)
    comparator: Mapped[PromotionGatesComparator] = mapped_column(Enum(PromotionGatesComparator, values_callable=lambda cls: [member.value for member in cls]), nullable=False)
    threshold: Mapped[float] = mapped_column(REAL, nullable=False)
    enforced: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    gate_id: Mapped[Optional[int]] = mapped_column(Integer, primary_key=True)
    description: Mapped[Optional[str]] = mapped_column(Text)


class RunManifests(Base):
    __tablename__ = 'run_manifests'
    __table_args__ = (
        Index('idx_run_manifests_experiment', 'experiment_id'),
        Index('idx_run_manifests_run', 'run_id')
    )

    manifest_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    manifest_version: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[str] = mapped_column(Text, nullable=False)
    experiment_id: Mapped[str] = mapped_column(Text, nullable=False)
    manifest_path: Mapped[str] = mapped_column(Text, nullable=False)
    manifest: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))


class RunMetrics(Base):
    __tablename__ = 'run_metrics'
    __table_args__ = (
        Index('idx_run_metrics_experiment', 'experiment_id', 'metric_name'),
        Index('idx_run_metrics_run', 'run_id'),
        Index('idx_run_metrics_run_metric', 'run_id', 'metric_name', 'iteration')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[str] = mapped_column(Text, nullable=False)
    experiment_id: Mapped[str] = mapped_column(Text, nullable=False)
    metric_name: Mapped[str] = mapped_column(Text, nullable=False)
    recorded_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    trial_idx: Mapped[Optional[int]] = mapped_column(Integer)
    fold_idx: Mapped[Optional[int]] = mapped_column(Integer)
    metric_value: Mapped[Optional[float]] = mapped_column(REAL)
    iteration: Mapped[Optional[int]] = mapped_column(Integer)
    total: Mapped[Optional[int]] = mapped_column(Integer)
    seq: Mapped[Optional[int]] = mapped_column(Integer)
    ts: Mapped[Optional[str]] = mapped_column(Text)


class Trades(Base):
    __tablename__ = 'trades'
    __table_args__ = (
        Index('trades_entry_ts_idx', 'entry_timestamp'),
        Index('trades_model_id_idx', 'model_id'),
        Index('trades_status_idx', 'status'),
        Index('trades_symbol_idx', 'symbol')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    side: Mapped[str] = mapped_column(Text, nullable=False)
    entry_timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_price: Mapped[float] = mapped_column(REAL, nullable=False)
    quantity: Mapped[float] = mapped_column(REAL, nullable=False, server_default=text('1'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'open'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    exit_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    exit_price: Mapped[Optional[float]] = mapped_column(REAL)
    pnl: Mapped[Optional[float]] = mapped_column(REAL)
    pnl_pct: Mapped[Optional[float]] = mapped_column(REAL)
    commission: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    slippage: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    model_id: Mapped[Optional[int]] = mapped_column(Integer)
    ensemble_id: Mapped[Optional[int]] = mapped_column(Integer)
    signal_confidence: Mapped[Optional[float]] = mapped_column(REAL)
    regime_id: Mapped[Optional[int]] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(Text)


class TrainingMetrics(Base):
    __tablename__ = 'training_metrics'
    __table_args__ = (
        Index('tm_session_idx', 'session_id'),
        Index('tm_session_metric_idx', 'session_id', 'metric_name', 'iteration')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    iteration: Mapped[int] = mapped_column(Integer, nullable=False)
    metric_name: Mapped[str] = mapped_column(Text, nullable=False)
    metric_value: Mapped[float] = mapped_column(REAL, nullable=False)
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))


class Uploads(Base):
    __tablename__ = 'uploads'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    uploaded_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'processing'"))


class UserPreferences(Base):
    __tablename__ = 'user_preferences'
    __table_args__ = (
        Index('user_preferences_key_unique', 'key', unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'general'"))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))


class Users(Base):
    __tablename__ = 'users'
    __table_args__ = (
        Index('users_username_unique', 'username', unique=True),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    password: Mapped[str] = mapped_column(Text, nullable=False)

    curriculum_bookmarks: Mapped[list['CurriculumBookmarks']] = relationship('CurriculumBookmarks', back_populates='user')
    curriculum_progress: Mapped[list['CurriculumProgress']] = relationship('CurriculumProgress', back_populates='user')
    curriculum_section_progress: Mapped[list['CurriculumSectionProgress']] = relationship('CurriculumSectionProgress', back_populates='user')


class BacktestRuns(Base):
    __tablename__ = 'backtest_runs'
    __table_args__ = (
        Index('backtest_runs_model_id_idx', 'model_id'),
        Index('backtest_runs_status_idx', 'status'),
        Index('backtest_runs_symbol_idx', 'symbol')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    timeframe: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'1m'"))
    initial_capital: Mapped[float] = mapped_column(REAL, nullable=False, server_default=text('10000'))
    position_size: Mapped[float] = mapped_column(REAL, nullable=False, server_default=text('1'))
    max_positions: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    model_id: Mapped[Optional[int]] = mapped_column(ForeignKey('ml_models.id'))
    broker_config_id: Mapped[Optional[int]] = mapped_column(ForeignKey('broker_configs.id'))
    train_start_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    train_end_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    test_start_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    test_end_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    split_ratio: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0.8'))
    stop_loss_ticks: Mapped[Optional[float]] = mapped_column(REAL)
    take_profit_ticks: Mapped[Optional[float]] = mapped_column(REAL)
    trailing_stop_ticks: Mapped[Optional[float]] = mapped_column(REAL)
    max_drawdown_pct: Mapped[Optional[float]] = mapped_column(REAL)
    signal_source: Mapped[Optional[str]] = mapped_column(Text)
    strategy_config: Mapped[Optional[str]] = mapped_column(Text)
    walk_forward_group_id: Mapped[Optional[str]] = mapped_column(Text)
    walk_forward_window_index: Mapped[Optional[int]] = mapped_column(Integer)
    total_spread_cost: Mapped[Optional[float]] = mapped_column(REAL)
    calmar_ratio: Mapped[Optional[float]] = mapped_column(REAL)
    total_trades: Mapped[Optional[int]] = mapped_column(Integer)
    win_rate: Mapped[Optional[float]] = mapped_column(REAL)
    profit_factor: Mapped[Optional[float]] = mapped_column(REAL)
    sharpe_ratio: Mapped[Optional[float]] = mapped_column(REAL)
    sortino_ratio: Mapped[Optional[float]] = mapped_column(REAL)
    max_drawdown: Mapped[Optional[float]] = mapped_column(REAL)
    total_return: Mapped[Optional[float]] = mapped_column(REAL)
    total_return_pct: Mapped[Optional[float]] = mapped_column(REAL)
    avg_win: Mapped[Optional[float]] = mapped_column(REAL)
    avg_loss: Mapped[Optional[float]] = mapped_column(REAL)
    largest_win: Mapped[Optional[float]] = mapped_column(REAL)
    largest_loss: Mapped[Optional[float]] = mapped_column(REAL)
    avg_holding_time_ms: Mapped[Optional[float]] = mapped_column(REAL)
    expectancy: Mapped[Optional[float]] = mapped_column(REAL)
    total_commissions: Mapped[Optional[float]] = mapped_column(REAL)
    total_slippage: Mapped[Optional[float]] = mapped_column(REAL)
    equity_curve: Mapped[Optional[str]] = mapped_column(Text)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[int]] = mapped_column(Integer)
    completed_at: Mapped[Optional[int]] = mapped_column(Integer)

    broker_config: Mapped[Optional['BrokerConfigs']] = relationship('BrokerConfigs', back_populates='backtest_runs')
    model: Mapped[Optional['MlModels']] = relationship('MlModels', back_populates='backtest_runs')
    backtest_trades: Mapped[list['BacktestTrades']] = relationship('BacktestTrades', back_populates='backtest_run')


class CurriculumBookmarks(Base):
    __tablename__ = 'curriculum_bookmarks'
    __table_args__ = (
        Index('cb_unique_idx', 'user_id', 'lesson_id'),
        Index('cb_user_idx', 'user_id')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), nullable=False)
    lesson_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    note: Mapped[Optional[str]] = mapped_column(Text)

    user: Mapped['Users'] = relationship('Users', back_populates='curriculum_bookmarks')


class CurriculumProgress(Base):
    __tablename__ = 'curriculum_progress'
    __table_args__ = (
        Index('cp_unique_idx', 'user_id', 'module_id', 'lesson_id'),
        Index('cp_user_lesson_idx', 'user_id', 'lesson_id'),
        Index('cp_user_module_idx', 'user_id', 'module_id')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), nullable=False)
    module_id: Mapped[str] = mapped_column(Text, nullable=False)
    lesson_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'not_started'"))
    time_spent_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    score: Mapped[Optional[float]] = mapped_column(REAL)
    completed_at: Mapped[Optional[int]] = mapped_column(Integer)

    user: Mapped['Users'] = relationship('Users', back_populates='curriculum_progress')


class CurriculumSectionProgress(Base):
    __tablename__ = 'curriculum_section_progress'
    __table_args__ = (
        Index('csp_unique_idx', 'user_id', 'lesson_id', 'section_index'),
        Index('csp_user_lesson_idx', 'user_id', 'lesson_id')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), nullable=False)
    lesson_id: Mapped[str] = mapped_column(Text, nullable=False)
    section_index: Mapped[int] = mapped_column(Integer, nullable=False)
    viewed_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))

    user: Mapped['Users'] = relationship('Users', back_populates='curriculum_section_progress')


class Deployments(Base):
    __tablename__ = 'deployments'
    __table_args__ = (
        CheckConstraint("mode IN ('shadow','paper','live')"),
        CheckConstraint("status IN ('running','paused','stopped','failed')"),
        Index('idx_deployments_one_live_per_sym_tf', 'symbol', 'timeframe', 'mode', sqlite_where=text("status = 'running' AND mode = 'live'"), unique=True),
        Index('idx_deployments_status', 'status'),
        Index('idx_deployments_symbol_tf_mode', 'symbol', 'timeframe', 'mode'),
        Index('idx_deployments_version', 'version_id')
    )

    version_id: Mapped[int] = mapped_column(ForeignKey('model_versions.version_id'), nullable=False)
    mode: Mapped[DeploymentsMode] = mapped_column(Enum(DeploymentsMode, values_callable=lambda cls: [member.value for member in cls]), nullable=False)
    status: Mapped[DeploymentsStatus] = mapped_column(Enum(DeploymentsStatus, values_callable=lambda cls: [member.value for member in cls]), nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    timeframe: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[str] = mapped_column(Text, nullable=False)
    predictions_emitted: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    created_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    deployment_id: Mapped[Optional[int]] = mapped_column(Integer, primary_key=True)
    stopped_at: Mapped[Optional[str]] = mapped_column(Text)
    paper_pnl: Mapped[Optional[float]] = mapped_column(REAL)
    last_prediction_at: Mapped[Optional[str]] = mapped_column(Text)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    version: Mapped['ModelVersions'] = relationship('ModelVersions', back_populates='deployments')


class GeneratedLabels(Base):
    __tablename__ = 'generated_labels'
    __table_args__ = (
        Index('generated_labels_generator_type_idx', 'generator_type'),
        Index('generated_labels_model_id_idx', 'model_id'),
        Index('generated_labels_recipe_idx', 'recipe', unique=True),
        Index('generated_labels_stage_idx', 'stage'),
        Index('generated_labels_status_idx', 'status'),
        Index('generated_labels_symbol_idx', 'symbol')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    generator_type: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    config: Mapped[str] = mapped_column(Text, nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    timeframe_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('1'))
    stage: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'specified'"))
    model_id: Mapped[Optional[int]] = mapped_column(ForeignKey('ml_models.id'))
    positive_count: Mapped[Optional[int]] = mapped_column(Integer)
    negative_count: Mapped[Optional[int]] = mapped_column(Integer)
    neutral_count: Mapped[Optional[int]] = mapped_column(Integer)
    label_distribution: Mapped[Optional[str]] = mapped_column(Text)
    data_start_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    data_end_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    parquet_path: Mapped[Optional[str]] = mapped_column(Text)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    generation_time_ms: Mapped[Optional[int]] = mapped_column(Integer)
    recipe: Mapped[Optional[str]] = mapped_column(Text)
    parameters_hash: Mapped[Optional[str]] = mapped_column(Text)
    validation: Mapped[Optional[str]] = mapped_column(Text)
    validated_at: Mapped[Optional[int]] = mapped_column(Integer)
    source_fingerprint: Mapped[Optional[str]] = mapped_column(Text)
    max_horizon_bars: Mapped[Optional[int]] = mapped_column(Integer)
    purge_bars: Mapped[Optional[int]] = mapped_column(Integer)
    embargo_bars: Mapped[Optional[int]] = mapped_column(Integer)
    landed_at: Mapped[Optional[int]] = mapped_column(Integer)
    retired_at: Mapped[Optional[int]] = mapped_column(Integer)
    stale_detected_at: Mapped[Optional[int]] = mapped_column(Integer)
    stale_reason: Mapped[Optional[str]] = mapped_column(Text)

    model: Mapped[Optional['MlModels']] = relationship('MlModels', back_populates='generated_labels')
    contrastive_pairs: Mapped[list['ContrastivePairs']] = relationship('ContrastivePairs', back_populates='label_set')
    training_sessions: Mapped[list['TrainingSessions']] = relationship('TrainingSessions', back_populates='label_set')


class ModelOutputs(Base):
    __tablename__ = 'model_outputs'
    __table_args__ = (
        Index('model_outputs_model_id_idx', 'model_id'),
        Index('model_outputs_symbol_ts_idx', 'symbol', 'timestamp'),
        Index('model_outputs_timestamp_idx', 'timestamp')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_id: Mapped[int] = mapped_column(ForeignKey('ml_models.id'), nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    prediction: Mapped[float] = mapped_column(REAL, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    prediction_label: Mapped[Optional[str]] = mapped_column(Text)
    confidence: Mapped[Optional[float]] = mapped_column(REAL)
    probabilities: Mapped[Optional[str]] = mapped_column(Text)
    features: Mapped[Optional[str]] = mapped_column(Text)

    model: Mapped['MlModels'] = relationship('MlModels', back_populates='model_outputs')


class NewsSymbols(Base):
    __tablename__ = 'news_symbols'
    __table_args__ = (
        Index('news_symbols_composite_idx', 'news_id', 'symbol'),
        Index('news_symbols_news_id_idx', 'news_id'),
        Index('news_symbols_symbol_idx', 'symbol')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    news_id: Mapped[int] = mapped_column(ForeignKey('news_articles.id'), nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    is_primary: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))

    news: Mapped['NewsArticles'] = relationship('NewsArticles', back_populates='news_symbols')


class RegimeHistory(Base):
    __tablename__ = 'regime_history'
    __table_args__ = (
        Index('regime_history_regime_id_idx', 'regime_id'),
        Index('regime_history_symbol_idx', 'symbol'),
        Index('regime_history_timestamp_idx', 'start_timestamp')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    regime_id: Mapped[int] = mapped_column(ForeignKey('market_regimes.id'), nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    start_timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    end_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    confidence: Mapped[Optional[float]] = mapped_column(REAL)
    detected_by: Mapped[Optional[str]] = mapped_column(Text)

    regime: Mapped['MarketRegimes'] = relationship('MarketRegimes', back_populates='regime_history')


class Runs(Base):
    __tablename__ = 'runs'
    __table_args__ = (
        Index('idx_runs_config_hash', 'config_hash'),
        Index('idx_runs_coordinates', 'experiment_id', 'trial_idx', 'fold_idx'),
        Index('idx_runs_experiment', 'experiment_id'),
        Index('idx_runs_heartbeat', 'heartbeat_at'),
        Index('idx_runs_legacy_model_id', 'legacy_model_id'),
        Index('idx_runs_status', 'status')
    )

    run_id: Mapped[str] = mapped_column(Text, primary_key=True)
    experiment_id: Mapped[str] = mapped_column(ForeignKey('experiments.experiment_id'), nullable=False)
    catalog_id: Mapped[str] = mapped_column(Text, nullable=False)
    runner_key: Mapped[str] = mapped_column(Text, nullable=False)
    legacy_model_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    config_hash: Mapped[str] = mapped_column(Text, nullable=False)
    manifest_hash: Mapped[str] = mapped_column(Text, nullable=False)
    manifest_path: Mapped[str] = mapped_column(Text, nullable=False)
    artifact_dir: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[str] = mapped_column(Text, nullable=False, server_default=text('CURRENT_TIMESTAMP'))
    trial_idx: Mapped[Optional[int]] = mapped_column(Integer)
    fold_idx: Mapped[Optional[int]] = mapped_column(Integer)
    training_session_id: Mapped[Optional[int]] = mapped_column(Integer)
    pid: Mapped[Optional[int]] = mapped_column(Integer)
    exit_code: Mapped[Optional[int]] = mapped_column(Integer)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    heartbeat_at: Mapped[Optional[str]] = mapped_column(Text)
    finished_at: Mapped[Optional[str]] = mapped_column(Text)

    experiment: Mapped['Experiments'] = relationship('Experiments', back_populates='runs')


class Strategies(Base):
    __tablename__ = 'strategies'
    __table_args__ = (
        Index('strategies_symbol_idx', 'symbol'),
        Index('strategies_type_idx', 'type')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    config: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    description: Mapped[Optional[str]] = mapped_column(Text)
    model_id: Mapped[Optional[int]] = mapped_column(ForeignKey('ml_models.id'))
    symbol: Mapped[Optional[str]] = mapped_column(Text)
    is_default: Mapped[Optional[int]] = mapped_column(Integer, server_default=text('0'))

    model: Mapped[Optional['MlModels']] = relationship('MlModels', back_populates='strategies')


class BacktestTrades(Base):
    __tablename__ = 'backtest_trades'
    __table_args__ = (
        Index('backtest_trades_entry_ts_idx', 'entry_timestamp'),
        Index('backtest_trades_run_id_idx', 'backtest_run_id')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    backtest_run_id: Mapped[int] = mapped_column(ForeignKey('backtest_runs.id'), nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    side: Mapped[str] = mapped_column(Text, nullable=False)
    entry_timestamp: Mapped[int] = mapped_column(Integer, nullable=False)
    entry_price: Mapped[float] = mapped_column(REAL, nullable=False)
    quantity: Mapped[float] = mapped_column(REAL, nullable=False, server_default=text('1'))
    exit_timestamp: Mapped[Optional[int]] = mapped_column(Integer)
    exit_price: Mapped[Optional[float]] = mapped_column(REAL)
    pnl: Mapped[Optional[float]] = mapped_column(REAL)
    net_pnl: Mapped[Optional[float]] = mapped_column(REAL)
    commission: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    slippage: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    spread_cost: Mapped[Optional[float]] = mapped_column(REAL, server_default=text('0'))
    entry_signal: Mapped[Optional[float]] = mapped_column(REAL)
    exit_reason: Mapped[Optional[str]] = mapped_column(Text)
    bars_held: Mapped[Optional[int]] = mapped_column(Integer)
    max_favorable_excursion: Mapped[Optional[float]] = mapped_column(REAL)
    max_adverse_excursion: Mapped[Optional[float]] = mapped_column(REAL)
    running_pnl: Mapped[Optional[float]] = mapped_column(REAL)

    backtest_run: Mapped['BacktestRuns'] = relationship('BacktestRuns', back_populates='backtest_trades')


class ContrastivePairs(Base):
    __tablename__ = 'contrastive_pairs'
    __table_args__ = (
        Index('contrastive_pairs_label_set_id_idx', 'label_set_id'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    label_set_id: Mapped[int] = mapped_column(ForeignKey('generated_labels.id'), nullable=False)
    anchor_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    positive_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    negative_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    pair_type: Mapped[str] = mapped_column(Text, nullable=False)
    similarity: Mapped[Optional[float]] = mapped_column(REAL)

    label_set: Mapped['GeneratedLabels'] = relationship('GeneratedLabels', back_populates='contrastive_pairs')


class TrainingSessions(Base):
    __tablename__ = 'training_sessions'
    __table_args__ = (
        Index('ts_label_set_id_idx', 'label_set_id'),
        Index('ts_model_type_idx', 'model_type'),
        Index('ts_status_idx', 'status'),
        Index('ts_symbol_idx', 'symbol'),
        Index('ts_versioned_model_id_idx', 'versioned_model_id'),
        Index('ts_wf_group_idx', 'walk_forward_group_id')
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'running'"))
    current_epoch: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('0'))
    max_epochs: Mapped[int] = mapped_column(Integer, nullable=False)
    learning_rate: Mapped[float] = mapped_column(REAL, nullable=False)
    started_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text('unixepoch() * 1000'))
    current_loss: Mapped[Optional[float]] = mapped_column(REAL)
    current_val_loss: Mapped[Optional[float]] = mapped_column(REAL)
    model_type: Mapped[Optional[str]] = mapped_column(Text)
    symbol: Mapped[Optional[str]] = mapped_column(Text)
    timeframe: Mapped[Optional[str]] = mapped_column(Text)
    versioned_model_id: Mapped[Optional[str]] = mapped_column(Text)
    hyperparameters: Mapped[Optional[str]] = mapped_column(Text)
    feature_categories: Mapped[Optional[str]] = mapped_column(Text)
    train_date_start: Mapped[Optional[int]] = mapped_column(Integer)
    train_date_end: Mapped[Optional[int]] = mapped_column(Integer)
    test_date_start: Mapped[Optional[int]] = mapped_column(Integer)
    test_date_end: Mapped[Optional[int]] = mapped_column(Integer)
    total_bars: Mapped[Optional[int]] = mapped_column(Integer)
    total_features: Mapped[Optional[int]] = mapped_column(Integer)
    model_path: Mapped[Optional[str]] = mapped_column(Text)
    diagnostics: Mapped[Optional[str]] = mapped_column(Text)
    quality_score: Mapped[Optional[float]] = mapped_column(REAL)
    evaluation_grade: Mapped[Optional[str]] = mapped_column(Text)
    walk_forward_group_id: Mapped[Optional[str]] = mapped_column(Text)
    window_index: Mapped[Optional[int]] = mapped_column(Integer)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    elapsed_sec: Mapped[Optional[float]] = mapped_column(REAL)
    resource_peak_memory_mb: Mapped[Optional[float]] = mapped_column(REAL)
    resource_avg_cpu_pct: Mapped[Optional[float]] = mapped_column(REAL)
    label_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey('generated_labels.id'))

    label_set: Mapped[Optional['GeneratedLabels']] = relationship('GeneratedLabels', back_populates='training_sessions')
