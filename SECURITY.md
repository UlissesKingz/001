# Segurança — 001 Online

A versão simplificada mantém as proteções que realmente importam para o jogo sem tornar a execução local dependente de serviços externos.

- regras e estado da partida são autoritativos no servidor;
- nickname, código de sala, permissões de host e todas as ações são validados no servidor;
- o navegador envia apenas intenções de ação (comprar, atualizar, capturar, descartar, votar), nunca o estado completo;
- tokens de reconexão são aleatórios e não são expostos a outros jogadores;
- eventos Socket.IO possuem rate limit por IP e payload limitado;
- origens podem ser restringidas em produção com `ALLOWED_ORIGINS` ou `APP_ORIGINS`;
- `X-Powered-By` é removido e headers básicos de segurança são enviados;
- MongoDB é opcional e acessado somente no servidor;
- `.env` é ignorado pelo Git e não deve conter segredos versionados.

O painel `/dev-salas` só é habilitado quando `ADMIN_PASSWORD` está configurada.
