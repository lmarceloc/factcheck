-- Registro de fontes (espelho de config/fontes.json; o campo ativo pode ser
-- desligado aqui para tirar uma fonte do ar sem novo deploy).
CREATE TABLE IF NOT EXISTS fontes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  orgao TEXT NOT NULL,
  base_url TEXT NOT NULL,
  tipo TEXT NOT NULL,
  modo TEXT NOT NULL,
  requer_chave INTEGER NOT NULL DEFAULT 0,
  prioridade INTEGER NOT NULL,
  frequencia_atualizacao TEXT,
  ultima_sincronizacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL
);

-- Toda consulta feita durante o debate fica registrada (auditoria das checagens).
CREATE TABLE IF NOT EXISTS consultas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER,
  ms INTEGER,
  cache TEXT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS consultas_criado_em ON consultas (criado_em);

-- Séries do Banco Central sincronizadas pelo cron.
CREATE TABLE IF NOT EXISTS bcb_series (
  codigo INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  unidade TEXT,
  ultima_sincronizacao TEXT
);
CREATE TABLE IF NOT EXISTS bcb_valores (
  codigo INTEGER NOT NULL,
  data TEXT NOT NULL,
  valor REAL NOT NULL,
  PRIMARY KEY (codigo, data)
);

-- Resultados do TSE por candidato e UF (carregados por scripts/tse-ingest.ts).
CREATE TABLE IF NOT EXISTS tse_votacao (
  ano INTEGER NOT NULL,
  turno INTEGER NOT NULL,
  uf TEXT NOT NULL,
  cargo TEXT NOT NULL,
  cargo_busca TEXT NOT NULL,
  sq_candidato TEXT NOT NULL,
  numero TEXT,
  nome_urna TEXT,
  nome TEXT,
  nome_busca TEXT NOT NULL,
  partido TEXT,
  situacao TEXT,
  votos INTEGER NOT NULL,
  PRIMARY KEY (ano, turno, uf, cargo_busca, sq_candidato)
);
CREATE INDEX IF NOT EXISTS tse_votacao_busca ON tse_votacao (ano, cargo_busca, nome_busca);

-- De onde veio cada carga do TSE (para citar a origem do dado).
CREATE TABLE IF NOT EXISTS tse_cargas (
  ano INTEGER NOT NULL,
  arquivo_url TEXT NOT NULL,
  linhas INTEGER NOT NULL,
  carregado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (ano, arquivo_url)
);

CREATE TABLE IF NOT EXISTS sincronizacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte TEXT NOT NULL,
  detalhe TEXT,
  ok INTEGER NOT NULL,
  mensagem TEXT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
