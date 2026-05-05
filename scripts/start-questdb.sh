#!/bin/bash

QUESTDB_HOME="/tmp/questdb/questdb-8.2.1-no-jre-bin"
QUESTDB_DATA="/tmp/questdb-data"

mkdir -p "$QUESTDB_DATA"

if [ ! -d "$QUESTDB_HOME" ]; then
  echo "Downloading QuestDB..."
  mkdir -p /tmp/questdb
  cd /tmp/questdb
  curl -sL https://github.com/questdb/questdb/releases/download/8.2.1/questdb-8.2.1-no-jre-bin.tar.gz | tar xz
fi

echo "Starting QuestDB..."
echo "  HTTP API: http://localhost:9000"
echo "  PostgreSQL: localhost:8812"
echo "  ILP: localhost:9009"

cd "$QUESTDB_HOME"
java -jar questdb.jar -d "$QUESTDB_DATA"
