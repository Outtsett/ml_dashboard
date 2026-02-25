/**
 * Technical Indicators Module
 *
 * Exports all indicator functionality for use throughout the application.
 */

// Core math primitives
export * from './math';

// SQL generation for DuckDB batch processing
export * from './sqlGenerator';

// Indicator registry and metadata
export * from './registry';

// TypeScript calculators (also re-exported via registry for backward compat)
export * from './calculators';
