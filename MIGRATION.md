# Migração da base anterior

Esta versão substitui a arquitetura anterior.

## Arquivos que precisam ser substituídos

- `server.js`
- `package.json`
- `package-lock.json`
- `render.yaml`
- `.gitignore`
- `.env.example`
- toda a pasta `public/`
- toda a pasta `src/`

## Arquivos antigos que podem ser apagados

Se ainda existirem no repositório, podem ser removidos porque não são mais usados:

- `src/lib/config.js`
- `src/lib/mongo.js`
- `src/lib/rooms.js`
- `src/lib/socketSecurity.js`
- `src/middleware/security.js`
- `src/middleware/origin.js`
- `src/models/GameRecord.js`

O novo `public/index.html` redireciona para `device.html`, então mesmo que o endereço raiz seja aberto, a escolha Desktop/Mobile aparece primeiro.
