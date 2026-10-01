# Segurança — 001 Online

## Princípios
- O servidor deve ser autoritativo para qualquer partida online.
- O cliente nunca pode decidir legalidade de jogadas, pontuação, vitória ou posse de sala.
- Nenhum segredo fica no GitHub.
- Toda entrada do cliente deve ser validada por esquema e por estado da partida.
- Nenhum HTML vindo do usuário é renderizado diretamente.

## Já aplicado nesta base
- `helmet` e CSP.
- HSTS em produção.
- `X-Powered-By` removido.
- `Permissions-Policy` restritiva.
- Limite pequeno de corpo HTTP.
- Rate limit HTTP.
- Rate limit de eventos Socket.IO.
- Validação de `Origin` em HTTP e WebSocket.
- Buffer máximo do Socket.IO limitado.
- MongoDB com `sanitizeFilter`.
- Health check incluindo MongoDB.
- `.env` ignorado no Git.
- Logs sem URI do banco, tokens ou segredos.
- Encerramento gracioso.

## Produção
1. Use HTTPS apenas.
2. Configure `APP_ORIGINS` com os domínios exatos.
3. Use usuário MongoDB exclusivo deste app e menor privilégio possível.
4. Restrinja a rede do Atlas ao menor conjunto possível de origens/IPs.
5. Ative MFA no GitHub, Render e MongoDB Atlas.
6. Proteja a branch `main` e exija revisão antes de merge.
7. Ative Dependabot / alertas de segurança no GitHub.
8. Não habilite CORS com `*`.
9. Não armazene senhas; o plano inicial usa sessões anônimas.
10. Não aceite resultados enviados pelo cliente como recordes válidos.

## Próxima fase
Ao adicionar lobby/partidas:
- código de sala gerado com `crypto`;
- nomes normalizados e limitados;
- schema Zod para cada evento;
- idempotência para ações;
- anti-replay com contador de turno/versão de estado;
- timeout e limpeza de salas;
- reconexão por token assinado;
- auditoria mínima de ações;
- índices TTL para dados temporários;
- persistência apenas do necessário.
