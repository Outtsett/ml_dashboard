// Barrel for the Settings tabs + shared config types. Recreated after the domain
// reorg flattened the former pages/settings/* tree into system/*. SettingsPage
// imports this barrel; the tabs and types now live as flat system/ siblings.
export { TrainingSettingsTab } from "@/system/TrainingSettingsTab";
export { ServerStatusTab } from "@/system/ServerStatusTab";
export { PreferencesTab } from "@/system/PreferencesTab";
export { PerformanceTab } from "@/system/PerformanceTab";
export { DesktopTab } from "@/system/DesktopTab";
export type { ServerConfig, ConnectionTestResult, Preferences } from "@/system/types";

