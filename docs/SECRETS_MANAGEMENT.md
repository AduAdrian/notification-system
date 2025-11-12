# Secrets Management Guide

## Overview

This guide provides best practices for managing secrets, API keys, and sensitive configuration data in the Notification System. Following these practices is critical for maintaining system security and OWASP compliance.

## Table of Contents

1. [What are Secrets?](#what-are-secrets)
2. [Never Store Secrets in Code](#never-store-secrets-in-code)
3. [Environment Variables](#environment-variables)
4. [Secrets Management Solutions](#secrets-management-solutions)
5. [Development vs Production](#development-vs-production)
6. [Secret Rotation](#secret-rotation)
7. [Access Control](#access-control)
8. [Audit and Monitoring](#audit-and-monitoring)

## What are Secrets?

Secrets include any sensitive information that should not be publicly accessible:

- API keys (SendGrid, Twilio, Firebase, etc.)
- Database credentials
- JWT signing secrets
- Encryption keys
- OAuth client secrets
- Third-party service tokens
- Private keys and certificates
- Session secrets

## Never Store Secrets in Code

### DON'T DO THIS:

```typescript
// ❌ NEVER hardcode secrets
const dbPassword = "MySecretPassword123";
const jwtSecret = "super-secret-key";
const apiKey = "sk_live_abc123xyz789";

// ❌ NEVER commit .env files
// Add .env to .gitignore immediately
```

### DO THIS INSTEAD:

```typescript
// ✅ Use environment variables
const dbPassword = process.env.DB_PASSWORD;
const jwtSecret = process.env.JWT_SECRET;
const apiKey = process.env.SENDGRID_API_KEY;

// ✅ Validate that secrets exist
if (!jwtSecret) {
  throw new Error('JWT_SECRET environment variable is required');
}
```

## Environment Variables

### Local Development

1. **Create .env file** (never commit this):
```bash
# .env
NODE_ENV=development
DB_PASSWORD=local_dev_password
JWT_SECRET=local_jwt_secret_change_in_production
SENDGRID_API_KEY=SG.test_key_for_development
```

2. **Use .env.example** (safe to commit):
```bash
# .env.example
NODE_ENV=development
DB_PASSWORD=your-database-password
JWT_SECRET=your-jwt-secret-key
SENDGRID_API_KEY=your-sendgrid-api-key
```

3. **Always add .env to .gitignore**:
```bash
# .gitignore
.env
.env.local
.env.*.local
*.pem
*.key
credentials.json
secrets/
```

### Loading Environment Variables

```typescript
// Load at application startup
import dotenv from 'dotenv';
dotenv.config();

// Validate required secrets
const requiredSecrets = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SENDGRID_API_KEY',
];

for (const secret of requiredSecrets) {
  if (!process.env[secret]) {
    throw new Error(`Missing required environment variable: ${secret}`);
  }
}
```

## Secrets Management Solutions

### Cloud-Based Solutions

#### 1. AWS Secrets Manager

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function getSecret(secretName: string): Promise<string> {
  const client = new SecretsManagerClient({ region: 'us-east-1' });

  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );

    return response.SecretString || '';
  } catch (error) {
    console.error('Error retrieving secret:', error);
    throw error;
  }
}

// Usage
const dbPassword = await getSecret('notification-system/db-password');
```

#### 2. HashiCorp Vault

```typescript
import Vault from 'node-vault';

const vault = Vault({
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN,
});

async function getVaultSecret(path: string): Promise<any> {
  try {
    const result = await vault.read(path);
    return result.data;
  } catch (error) {
    console.error('Error reading from Vault:', error);
    throw error;
  }
}

// Usage
const secrets = await getVaultSecret('secret/data/notification-system');
const dbPassword = secrets.db_password;
```

#### 3. Azure Key Vault

```typescript
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

const vaultUrl = `https://${process.env.AZURE_VAULT_NAME}.vault.azure.net`;
const credential = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, credential);

async function getAzureSecret(secretName: string): Promise<string> {
  try {
    const secret = await client.getSecret(secretName);
    return secret.value || '';
  } catch (error) {
    console.error('Error retrieving Azure secret:', error);
    throw error;
  }
}

// Usage
const dbPassword = await getAzureSecret('db-password');
```

#### 4. Google Cloud Secret Manager

```typescript
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

async function getGCPSecret(secretName: string): Promise<string> {
  const projectId = process.env.GCP_PROJECT_ID;
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

  try {
    const [version] = await client.accessSecretVersion({ name });
    return version.payload?.data?.toString() || '';
  } catch (error) {
    console.error('Error retrieving GCP secret:', error);
    throw error;
  }
}

// Usage
const dbPassword = await getGCPSecret('db-password');
```

### Docker Secrets

For Docker Swarm deployments:

```yaml
# docker-compose.yml
version: '3.8'
services:
  notification-service:
    image: notification-service:latest
    secrets:
      - db_password
      - jwt_secret
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password
      JWT_SECRET_FILE: /run/secrets/jwt_secret

secrets:
  db_password:
    external: true
  jwt_secret:
    external: true
```

```typescript
// Read Docker secrets from files
import fs from 'fs';

function readSecret(secretName: string): string {
  const secretFile = process.env[`${secretName.toUpperCase()}_FILE`];

  if (secretFile && fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }

  // Fallback to environment variable
  return process.env[secretName] || '';
}

const dbPassword = readSecret('DB_PASSWORD');
```

## Development vs Production

### Development

- Use `.env` files for local development
- Use test/sandbox API keys where available
- Document all required environment variables in `.env.example`
- Never use production secrets in development

### Staging

- Use separate secrets from production
- Mirror production secret structure
- Implement same security controls as production

### Production

- **NEVER** use `.env` files in production
- Use cloud-based secrets management (AWS Secrets Manager, etc.)
- Enable secret encryption at rest and in transit
- Implement strict access controls
- Enable audit logging for all secret access
- Use separate secrets for each environment

## Secret Rotation

### Why Rotate Secrets?

- Limit exposure window if secrets are compromised
- Comply with security policies and regulations
- Reduce risk from insider threats

### Rotation Strategy

```typescript
// Example: JWT Secret Rotation
class SecretRotationService {
  private currentSecret: string;
  private previousSecret: string;
  private rotationSchedule: number = 90 * 24 * 60 * 60 * 1000; // 90 days

  async rotateJWTSecret(): Promise<void> {
    // Store current secret as previous
    this.previousSecret = this.currentSecret;

    // Generate new secret
    this.currentSecret = crypto.randomBytes(64).toString('hex');

    // Update in secrets manager
    await this.updateSecretInVault('jwt_secret', this.currentSecret);

    // Schedule next rotation
    setTimeout(() => this.rotateJWTSecret(), this.rotationSchedule);
  }

  verifyToken(token: string): any {
    try {
      // Try current secret first
      return jwt.verify(token, this.currentSecret);
    } catch (error) {
      // Fall back to previous secret during rotation window
      return jwt.verify(token, this.previousSecret);
    }
  }
}
```

### API Key Rotation

See `apikey.service.ts` for automatic API key rotation implementation.

**Best Practices:**
- Rotate secrets every 90 days (or more frequently for high-risk secrets)
- Provide grace period for old secrets (7-14 days)
- Automate rotation where possible
- Log all rotation events
- Notify relevant teams before rotation

## Access Control

### Principle of Least Privilege

```yaml
# Example: IAM Policy for AWS Secrets Manager
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:us-east-1:123456789:secret:notification-system/*"
      ]
    }
  ]
}
```

### Role-Based Access

- **Developers**: Read access to dev/staging secrets only
- **CI/CD Pipeline**: Read access to specific secrets needed for deployment
- **Production Services**: Read access to production secrets via service roles
- **Security Team**: Full access for rotation and auditing
- **No Human Access**: Production secrets should only be accessed by services

### Service Accounts

```typescript
// Use service accounts with limited permissions
const credentials = new DefaultAzureCredential({
  managedIdentityClientId: process.env.MANAGED_IDENTITY_CLIENT_ID
});

// Service automatically authenticates using its identity
// No need to store credentials in code
```

## Audit and Monitoring

### Enable Audit Logging

```typescript
// Log secret access (without logging the actual secret values)
logger.info('Secret accessed', {
  secretName: 'db_password',
  userId: currentUser.id,
  timestamp: new Date(),
  accessMethod: 'environment_variable',
  success: true
});

// Alert on suspicious access patterns
if (accessCount > threshold) {
  logger.warn('Excessive secret access detected', {
    secretName: 'api_key',
    accessCount,
    timeWindow: '1 hour'
  });
  // Send alert to security team
}
```

### Monitoring Checklist

- [ ] Enable CloudTrail (AWS) or equivalent for all secret access
- [ ] Set up alerts for secret rotation failures
- [ ] Monitor for unauthorized access attempts
- [ ] Track secret usage patterns
- [ ] Audit who has access to secrets regularly
- [ ] Review access logs weekly

### Security Incident Response

If secrets are compromised:

1. **Immediately revoke** the compromised secret
2. **Rotate** to new secret
3. **Audit** all access logs to determine scope of breach
4. **Notify** affected parties if required by policy
5. **Investigate** how the secret was compromised
6. **Remediate** the vulnerability
7. **Document** the incident and lessons learned

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # Secrets are stored in GitHub Secrets
      - name: Deploy
        env:
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
          JWT_SECRET: ${{ secrets.JWT_SECRET }}
          API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: |
          npm run deploy
```

### GitLab CI

```yaml
# .gitlab-ci.yml
deploy:
  stage: deploy
  script:
    - npm run deploy
  variables:
    DB_PASSWORD: $DB_PASSWORD
    JWT_SECRET: $JWT_SECRET
  only:
    - main
```

## Security Checklist

- [ ] All secrets stored in environment variables or secrets manager
- [ ] No secrets committed to git repository
- [ ] `.env` added to `.gitignore`
- [ ] `.env.example` provided with placeholder values
- [ ] Production uses cloud-based secrets management
- [ ] Secrets rotation policy implemented (90 days)
- [ ] Audit logging enabled for secret access
- [ ] Access control follows principle of least privilege
- [ ] Secrets encrypted at rest and in transit
- [ ] No secrets in Docker images or logs
- [ ] CI/CD secrets stored in secure variables
- [ ] Regular security audits scheduled
- [ ] Incident response plan documented
- [ ] Team trained on secrets management

## Additional Resources

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [HashiCorp Vault Documentation](https://www.vaultproject.io/docs)
- [12-Factor App: Config](https://12factor.net/config)

## Questions?

For security concerns or questions about secrets management, contact the security team immediately.

**Remember: When in doubt, treat it as a secret and protect it accordingly.**
