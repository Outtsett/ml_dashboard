module.exports = {
  apps: [
    {
      name: "oanda-stream",
      script: "scripts/ingest-oanda.ts",
      args: "stream",
      cwd: "E:\\source\\repos\\ml_dashboard",
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      interpreter_args: "--import tsx/esm",
      autorestart: true,
      max_restarts: 100,
      restart_delay: 5000,
      watch: false,
      env: {
        QUESTDB_HOST: "localhost",
        QUESTDB_HTTP_PORT: "9000",
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "E:\\source\\repos\\ml_dashboard\\logs\\oanda-stream-error.log",
      out_file: "E:\\source\\repos\\ml_dashboard\\logs\\oanda-stream-out.log",
      merge_logs: true,
      max_memory_restart: "256M",
    },
  ],
};
