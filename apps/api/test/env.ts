// Variables de entorno para pruebas (BD aislada retroburger_test, sólo local/CI).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://retroburger_app:app_dev@localhost:5432/retroburger_test';
process.env.DATABASE_MIGRATE_URL ??= 'postgres://retroburger_owner:owner_dev@localhost:5432/retroburger_test';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret-123456';
process.env.LOGIN_RATE_LIMIT_MAX ??= '1000';
process.env.RATE_LIMIT_MAX ??= '100000';
process.env.RATE_LIMIT_AUTH_MAX ??= '1000000';
process.env.LOGIN_IP_RATE_LIMIT_MAX ??= '100000';
process.env.PUBLIC_SENSITIVE_RATE_LIMIT_MAX ??= '100000';
process.env.PUBLIC_READ_RATE_LIMIT_MAX ??= '100000';
