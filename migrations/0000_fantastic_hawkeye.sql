CREATE TABLE `backtest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`model_id` integer,
	`symbol` text NOT NULL,
	`broker_config_id` integer,
	`timeframe` text DEFAULT '1m' NOT NULL,
	`train_start_timestamp` integer,
	`train_end_timestamp` integer,
	`test_start_timestamp` integer,
	`test_end_timestamp` integer,
	`split_ratio` real DEFAULT 0.8,
	`initial_capital` real DEFAULT 10000 NOT NULL,
	`position_size` real DEFAULT 1 NOT NULL,
	`max_positions` integer DEFAULT 1 NOT NULL,
	`stop_loss_ticks` real,
	`take_profit_ticks` real,
	`trailing_stop_ticks` real,
	`max_drawdown_pct` real,
	`signal_source` text,
	`strategy_config` text,
	`walk_forward_group_id` text,
	`walk_forward_window_index` integer,
	`total_spread_cost` real,
	`calmar_ratio` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_trades` integer,
	`win_rate` real,
	`profit_factor` real,
	`sharpe_ratio` real,
	`sortino_ratio` real,
	`max_drawdown` real,
	`total_return` real,
	`total_return_pct` real,
	`avg_win` real,
	`avg_loss` real,
	`largest_win` real,
	`largest_loss` real,
	`avg_holding_time_ms` real,
	`expectancy` real,
	`total_commissions` real,
	`total_slippage` real,
	`equity_curve` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `ml_models`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`broker_config_id`) REFERENCES `broker_configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `backtest_runs_model_id_idx` ON `backtest_runs` (`model_id`);--> statement-breakpoint
CREATE INDEX `backtest_runs_symbol_idx` ON `backtest_runs` (`symbol`);--> statement-breakpoint
CREATE INDEX `backtest_runs_status_idx` ON `backtest_runs` (`status`);--> statement-breakpoint
CREATE TABLE `backtest_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backtest_run_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`entry_timestamp` integer NOT NULL,
	`exit_timestamp` integer,
	`entry_price` real NOT NULL,
	`exit_price` real,
	`quantity` real DEFAULT 1 NOT NULL,
	`pnl` real,
	`net_pnl` real,
	`commission` real DEFAULT 0,
	`slippage` real DEFAULT 0,
	`spread_cost` real DEFAULT 0,
	`entry_signal` real,
	`exit_reason` text,
	`bars_held` integer,
	`max_favorable_excursion` real,
	`max_adverse_excursion` real,
	`running_pnl` real,
	FOREIGN KEY (`backtest_run_id`) REFERENCES `backtest_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backtest_trades_run_id_idx` ON `backtest_trades` (`backtest_run_id`);--> statement-breakpoint
CREATE INDEX `backtest_trades_entry_ts_idx` ON `backtest_trades` (`entry_timestamp`);--> statement-breakpoint
CREATE TABLE `broker_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`broker` text NOT NULL,
	`asset_type` text NOT NULL,
	`commission_type` text NOT NULL,
	`commission_per_lot` real DEFAULT 0,
	`commission_per_side` real DEFAULT 0,
	`commission_per_round_turn` real DEFAULT 0,
	`spread_type` text DEFAULT 'variable' NOT NULL,
	`typical_spread_pips` real DEFAULT 0,
	`slippage_model` text DEFAULT 'fixed' NOT NULL,
	`slippage_ticks` real DEFAULT 0,
	`margin_type` text DEFAULT 'fixed' NOT NULL,
	`default_margin` real,
	`config` text,
	`is_default` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broker_configs_name_unique` ON `broker_configs` (`name`);--> statement-breakpoint
CREATE INDEX `broker_configs_name_idx` ON `broker_configs` (`name`);--> statement-breakpoint
CREATE INDEX `broker_configs_asset_type_idx` ON `broker_configs` (`asset_type`);--> statement-breakpoint
CREATE TABLE `coherence_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`symbol` text NOT NULL,
	`model_correlations` text NOT NULL,
	`agreement_matrix` text NOT NULL,
	`ensemble_signal` text,
	`ensemble_confidence` real,
	`divergence_score` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `coherence_snapshots_ts_idx` ON `coherence_snapshots` (`timestamp`);--> statement-breakpoint
CREATE INDEX `coherence_snapshots_symbol_idx` ON `coherence_snapshots` (`symbol`);--> statement-breakpoint
CREATE TABLE `contrastive_pairs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label_set_id` integer NOT NULL,
	`anchor_idx` integer NOT NULL,
	`positive_idx` integer NOT NULL,
	`negative_idx` integer NOT NULL,
	`pair_type` text NOT NULL,
	`similarity` real,
	FOREIGN KEY (`label_set_id`) REFERENCES `generated_labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contrastive_pairs_label_set_id_idx` ON `contrastive_pairs` (`label_set_id`);--> statement-breakpoint
CREATE TABLE `curriculum_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cb_unique_idx` ON `curriculum_bookmarks` (`user_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `cb_user_idx` ON `curriculum_bookmarks` (`user_id`);--> statement-breakpoint
CREATE TABLE `curriculum_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`score` real,
	`time_spent_ms` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cp_user_module_idx` ON `curriculum_progress` (`user_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `cp_user_lesson_idx` ON `curriculum_progress` (`user_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `cp_unique_idx` ON `curriculum_progress` (`user_id`,`module_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `curriculum_section_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`section_index` integer NOT NULL,
	`viewed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `csp_unique_idx` ON `curriculum_section_progress` (`user_id`,`lesson_id`,`section_index`);--> statement-breakpoint
CREATE INDEX `csp_user_lesson_idx` ON `curriculum_section_progress` (`user_id`,`lesson_id`);--> statement-breakpoint
CREATE TABLE `ensemble_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`model_ids` text NOT NULL,
	`weights` text,
	`aggregation_method` text DEFAULT 'vote' NOT NULL,
	`confidence_threshold` real DEFAULT 0.5,
	`unanimity_required` integer DEFAULT 0,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ensemble_configs_name_unique` ON `ensemble_configs` (`name`);--> statement-breakpoint
CREATE INDEX `ensemble_configs_name_idx` ON `ensemble_configs` (`name`);--> statement-breakpoint
CREATE INDEX `ensemble_configs_status_idx` ON `ensemble_configs` (`status`);--> statement-breakpoint
CREATE TABLE `evaluation_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`stage` text NOT NULL,
	`test_name` text NOT NULL,
	`test_value` real,
	`test_passed` integer,
	`p_value` real,
	`details` text,
	`computed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `er_session_stage_idx` ON `evaluation_results` (`session_id`,`stage`,`test_name`);--> statement-breakpoint
CREATE INDEX `er_session_idx` ON `evaluation_results` (`session_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` text NOT NULL,
	`stream_position` integer NOT NULL,
	`type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`data` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_stream_position_unique` ON `events` (`stream_id`,`stream_position`);--> statement-breakpoint
CREATE INDEX `idx_events_stream` ON `events` (`stream_id`,`stream_position`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `idx_events_created` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `feature_importance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_name` text NOT NULL,
	`feature_name` text NOT NULL,
	`importance` real NOT NULL,
	`category` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`features` text NOT NULL,
	`normalization` text,
	`lag_periods` text,
	`technical_indicators` text,
	`symbols` text,
	`timeframe` text,
	`lookback_bars` integer DEFAULT 100,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_sets_name_unique` ON `feature_sets` (`name`);--> statement-breakpoint
CREATE INDEX `feature_sets_name_idx` ON `feature_sets` (`name`);--> statement-breakpoint
CREATE TABLE `generated_labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_id` integer,
	`name` text NOT NULL,
	`generator_type` text NOT NULL,
	`category` text NOT NULL,
	`symbol` text NOT NULL,
	`config` text NOT NULL,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`positive_count` integer,
	`negative_count` integer,
	`neutral_count` integer,
	`label_distribution` text,
	`data_start_timestamp` integer,
	`data_end_timestamp` integer,
	`parquet_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`generation_time_ms` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `ml_models`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `generated_labels_model_id_idx` ON `generated_labels` (`model_id`);--> statement-breakpoint
CREATE INDEX `generated_labels_generator_type_idx` ON `generated_labels` (`generator_type`);--> statement-breakpoint
CREATE INDEX `generated_labels_symbol_idx` ON `generated_labels` (`symbol`);--> statement-breakpoint
CREATE INDEX `generated_labels_status_idx` ON `generated_labels` (`status`);--> statement-breakpoint
CREATE TABLE `hpo_search_spaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`model_type` text NOT NULL,
	`search_space` text NOT NULL,
	`optimizer_type` text,
	`optimizer_config` text,
	`times_used` integer DEFAULT 0 NOT NULL,
	`best_score_ever` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hpo_ss_model_type_idx` ON `hpo_search_spaces` (`model_type`);--> statement-breakpoint
CREATE INDEX `hpo_ss_name_idx` ON `hpo_search_spaces` (`name`);--> statement-breakpoint
CREATE TABLE `hpo_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`model_type` text NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`optimizer_type` text NOT NULL,
	`optimizer_config` text NOT NULL,
	`objective_metric` text NOT NULL,
	`objective_direction` text DEFAULT 'minimize' NOT NULL,
	`search_space` text NOT NULL,
	`fixed_hyperparameters` text,
	`total_trials` integer DEFAULT 0 NOT NULL,
	`completed_trials` integer DEFAULT 0 NOT NULL,
	`pruned_trials` integer DEFAULT 0 NOT NULL,
	`failed_trials` integer DEFAULT 0 NOT NULL,
	`best_trial_id` integer,
	`best_score` real,
	`best_params` text,
	`date_range_start` text,
	`date_range_end` text,
	`max_bars` integer,
	`feature_categories` text,
	`error_message` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`elapsed_sec` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hpo_sessions_session_id_unique` ON `hpo_sessions` (`session_id`);--> statement-breakpoint
CREATE INDEX `hpo_s_session_id_idx` ON `hpo_sessions` (`session_id`);--> statement-breakpoint
CREATE INDEX `hpo_s_model_type_idx` ON `hpo_sessions` (`model_type`);--> statement-breakpoint
CREATE INDEX `hpo_s_symbol_idx` ON `hpo_sessions` (`symbol`);--> statement-breakpoint
CREATE INDEX `hpo_s_status_idx` ON `hpo_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `hpo_s_optimizer_type_idx` ON `hpo_sessions` (`optimizer_type`);--> statement-breakpoint
CREATE TABLE `hpo_trials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`trial_id` integer NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`params` text NOT NULL,
	`score` real,
	`metrics` text,
	`pruned` integer DEFAULT 0 NOT NULL,
	`pruned_at_step` integer,
	`error` text,
	`duration_sec` real,
	`iteration_history` text,
	`model_path` text,
	`trained_model_id` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `hpo_t_session_id_idx` ON `hpo_trials` (`session_id`);--> statement-breakpoint
CREATE INDEX `hpo_t_session_trial_idx` ON `hpo_trials` (`session_id`,`trial_id`);--> statement-breakpoint
CREATE INDEX `hpo_t_status_idx` ON `hpo_trials` (`status`);--> statement-breakpoint
CREATE INDEX `hpo_t_score_idx` ON `hpo_trials` (`score`);--> statement-breakpoint
CREATE TABLE `ingested_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_path` text NOT NULL,
	`file_hash` text,
	`file_size` integer,
	`row_count` integer,
	`symbol` text,
	`ts_min` integer,
	`ts_max` integer,
	`ingested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingested_files_file_path_unique` ON `ingested_files` (`file_path`);--> statement-breakpoint
CREATE INDEX `ingested_files_file_path_idx` ON `ingested_files` (`file_path`);--> statement-breakpoint
CREATE INDEX `ingested_files_symbol_idx` ON `ingested_files` (`symbol`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`asset_type` text NOT NULL,
	`exchange` text,
	`tick_size` real NOT NULL,
	`tick_value` real NOT NULL,
	`point_value` real NOT NULL,
	`contract_size` real DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`margin_requirement` real,
	`trading_hours` text,
	`decimal_places` integer DEFAULT 2 NOT NULL,
	`pip_size` real,
	`contract_months` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_symbol_unique` ON `instruments` (`symbol`);--> statement-breakpoint
CREATE INDEX `instruments_symbol_idx` ON `instruments` (`symbol`);--> statement-breakpoint
CREATE INDEX `instruments_asset_type_idx` ON `instruments` (`asset_type`);--> statement-breakpoint
CREATE TABLE `loss_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`epoch` integer NOT NULL,
	`loss` real NOT NULL,
	`val_loss` real NOT NULL,
	`timestamp` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_epoch_idx` ON `loss_history` (`session_id`,`epoch`);--> statement-breakpoint
CREATE TABLE `market_regimes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`volatility_level` text,
	`trend_direction` text,
	`characteristics` text,
	`detection_rules` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_regimes_name_idx` ON `market_regimes` (`name`);--> statement-breakpoint
CREATE TABLE `ml_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`architecture` text NOT NULL,
	`category` text,
	`subcategory` text,
	`description` text,
	`hyperparameters` text,
	`feature_set_id` integer,
	`training_data_start` integer,
	`training_data_end` integer,
	`validation_split` real DEFAULT 0.2,
	`target_column` text,
	`target_horizon` integer,
	`metrics` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ml_models_name_version_idx` ON `ml_models` (`name`,`version`);--> statement-breakpoint
CREATE INDEX `ml_models_architecture_idx` ON `ml_models` (`architecture`);--> statement-breakpoint
CREATE INDEX `ml_models_category_idx` ON `ml_models` (`category`);--> statement-breakpoint
CREATE INDEX `ml_models_subcategory_idx` ON `ml_models` (`subcategory`);--> statement-breakpoint
CREATE INDEX `ml_models_status_idx` ON `ml_models` (`status`);--> statement-breakpoint
CREATE TABLE `model_outputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`timestamp` integer NOT NULL,
	`prediction` real NOT NULL,
	`prediction_label` text,
	`confidence` real,
	`probabilities` text,
	`features` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `ml_models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `model_outputs_model_id_idx` ON `model_outputs` (`model_id`);--> statement-breakpoint
CREATE INDEX `model_outputs_symbol_ts_idx` ON `model_outputs` (`symbol`,`timestamp`);--> statement-breakpoint
CREATE INDEX `model_outputs_timestamp_idx` ON `model_outputs` (`timestamp`);--> statement-breakpoint
CREATE TABLE `mw_file_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`last_modified` real NOT NULL,
	`rows_imported` integer DEFAULT 0 NOT NULL,
	`symbol` text,
	`timeframe` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mw_file_states_file_path_unique` ON `mw_file_states` (`file_path`);--> statement-breakpoint
CREATE TABLE `news_articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`content` text,
	`source` text NOT NULL,
	`source_url` text,
	`published_at` integer NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sentiment_score` real,
	`sentiment_label` text,
	`sentiment_confidence` real,
	`relevance_score` real,
	`category` text,
	`external_id` text
);
--> statement-breakpoint
CREATE INDEX `news_published_at_idx` ON `news_articles` (`published_at`);--> statement-breakpoint
CREATE INDEX `news_source_idx` ON `news_articles` (`source`);--> statement-breakpoint
CREATE INDEX `news_sentiment_idx` ON `news_articles` (`sentiment_score`);--> statement-breakpoint
CREATE INDEX `news_external_id_idx` ON `news_articles` (`external_id`);--> statement-breakpoint
CREATE TABLE `news_symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`news_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`news_id`) REFERENCES `news_articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `news_symbols_news_id_idx` ON `news_symbols` (`news_id`);--> statement-breakpoint
CREATE INDEX `news_symbols_symbol_idx` ON `news_symbols` (`symbol`);--> statement-breakpoint
CREATE INDEX `news_symbols_composite_idx` ON `news_symbols` (`news_id`,`symbol`);--> statement-breakpoint
CREATE TABLE `regime_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`regime_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`start_timestamp` integer NOT NULL,
	`end_timestamp` integer,
	`confidence` real,
	`detected_by` text,
	FOREIGN KEY (`regime_id`) REFERENCES `market_regimes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `regime_history_regime_id_idx` ON `regime_history` (`regime_id`);--> statement-breakpoint
CREATE INDEX `regime_history_symbol_idx` ON `regime_history` (`symbol`);--> statement-breakpoint
CREATE INDEX `regime_history_timestamp_idx` ON `regime_history` (`start_timestamp`);--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`config` text NOT NULL,
	`model_id` integer,
	`symbol` text,
	`is_default` integer DEFAULT 0,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `ml_models`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `strategies_type_idx` ON `strategies` (`type`);--> statement-breakpoint
CREATE INDEX `strategies_symbol_idx` ON `strategies` (`symbol`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`entry_timestamp` integer NOT NULL,
	`exit_timestamp` integer,
	`entry_price` real NOT NULL,
	`exit_price` real,
	`quantity` real DEFAULT 1 NOT NULL,
	`pnl` real,
	`pnl_pct` real,
	`commission` real DEFAULT 0,
	`slippage` real DEFAULT 0,
	`model_id` integer,
	`ensemble_id` integer,
	`signal_confidence` real,
	`regime_id` integer,
	`notes` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trades_symbol_idx` ON `trades` (`symbol`);--> statement-breakpoint
CREATE INDEX `trades_entry_ts_idx` ON `trades` (`entry_timestamp`);--> statement-breakpoint
CREATE INDEX `trades_model_id_idx` ON `trades` (`model_id`);--> statement-breakpoint
CREATE INDEX `trades_status_idx` ON `trades` (`status`);--> statement-breakpoint
CREATE TABLE `training_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`iteration` integer NOT NULL,
	`metric_name` text NOT NULL,
	`metric_value` real NOT NULL,
	`timestamp` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tm_session_metric_idx` ON `training_metrics` (`session_id`,`metric_name`,`iteration`);--> statement-breakpoint
CREATE INDEX `tm_session_idx` ON `training_metrics` (`session_id`);--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`model_name` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`current_epoch` integer DEFAULT 0 NOT NULL,
	`max_epochs` integer NOT NULL,
	`current_loss` real,
	`current_val_loss` real,
	`learning_rate` real NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`model_type` text,
	`symbol` text,
	`timeframe` text,
	`versioned_model_id` text,
	`hyperparameters` text,
	`feature_categories` text,
	`train_date_start` integer,
	`train_date_end` integer,
	`test_date_start` integer,
	`test_date_end` integer,
	`total_bars` integer,
	`total_features` integer,
	`model_path` text,
	`diagnostics` text,
	`quality_score` real,
	`evaluation_grade` text,
	`walk_forward_group_id` text,
	`window_index` integer,
	`error_message` text,
	`elapsed_sec` real,
	`resource_peak_memory_mb` real,
	`resource_avg_cpu_pct` real
);
--> statement-breakpoint
CREATE INDEX `ts_model_type_idx` ON `training_sessions` (`model_type`);--> statement-breakpoint
CREATE INDEX `ts_symbol_idx` ON `training_sessions` (`symbol`);--> statement-breakpoint
CREATE INDEX `ts_status_idx` ON `training_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `ts_versioned_model_id_idx` ON `training_sessions` (`versioned_model_id`);--> statement-breakpoint
CREATE INDEX `ts_wf_group_idx` ON `training_sessions` (`walk_forward_group_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`symbol` text NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`uploaded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_preferences_key_unique` ON `user_preferences` (`key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);