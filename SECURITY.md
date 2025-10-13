# Security Best Practices

## Overview

This document outlines security best practices for deploying and maintaining the CTI Middleware.

## Authentication & Authorization

### FreePBX AMI

1. **Restrict IP Access:**
   ```ini
   # /etc/asterisk/manager.conf
   [admin]
   secret = strong_password_here
   deny = 0.0.0.0/0.0.0.0
   permit = 192.168.1.100/255.255.255.255  # Middleware server IP only
   read = all
   write = all
   ```

2. **Use Strong Passwords:**
   - Minimum 16 characters
   - Mix of uppercase, lowercase, numbers, symbols
   - Change regularly (every 90 days)

3. **Create Dedicated AMI User:**
   - Don't use default 'admin' account
   - Create specific user for CTI middleware
   - Grant only necessary permissions

### SuiteCRM API

1. **OAuth2 Key Security:**
   ```bash
   # Ensure proper permissions
   chmod 600 private.key public.key
   chown www-data:www-data *.key
   
   # Backup keys securely
   cp private.key private.key.backup
   ```

2. **Rotate Credentials:**
   - Regenerate OAuth2 keys every 6 months
   - Update client secret after any security incident
   - Keep backup of old keys for 30 days

3. **API User Permissions:**
   - Create dedicated API user
   - Grant minimum required permissions
   - Enable API access only for this user

### ElevenLabs Webhook

1. **Signature Verification:**
   - Always enable signature verification in production
   - Store webhook secret securely
   - Never log or expose webhook secret

2. **HTTPS Only:**
   - Always use HTTPS for webhook endpoints
   - Configure valid SSL/TLS certificates
   - Enable HSTS headers

## Network Security

### Firewall Configuration

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow WebSocket (if different port)
sudo ufw allow 3000/tcp

# Allow AMI from specific IP only
sudo ufw allow from 192.168.1.50 to any port 5038 proto tcp

# Enable firewall
sudo ufw enable
```

### VPN Access

For sensitive deployments:

1. Place middleware behind VPN
2. Require VPN connection for AMI access
3. Use site-to-site VPN between FreePBX and middleware
4. Implement zero-trust network architecture

### SSL/TLS Configuration

1. **Use Strong Ciphers:**
   ```nginx
   # nginx example
   ssl_protocols TLSv1.2 TLSv1.3;
   ssl_ciphers HIGH:!aNULL:!MD5;
   ssl_prefer_server_ciphers on;
   ```

2. **Certificate Management:**
   - Use Let's Encrypt for free certificates
   - Auto-renew certificates
   - Monitor certificate expiration

3. **HTTPS Redirect:**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       return 301 https://$server_name$request_uri;
   }
   ```

## Application Security

### Environment Variables

1. **Never Commit .env:**
   ```bash
   # Add to .gitignore
   .env
   .env.*
   !.env.example
   ```

2. **Use Secrets Management:**
   - AWS Secrets Manager
   - HashiCorp Vault
   - Azure Key Vault
   - Google Secret Manager

3. **File Permissions:**
   ```bash
   chmod 600 .env
   chown nodeuser:nodeuser .env
   ```

### API Key Management

1. **Generate Strong Keys:**
   ```bash
   # Generate 256-bit key
   openssl rand -hex 32
   ```

2. **Rotate Regularly:**
   - Change API keys every 90 days
   - Invalidate old keys after rotation
   - Notify clients of key changes

3. **Rate Limiting:**
   - Implement per-key rate limits
   - Monitor for abuse
   - Block suspicious activity

### Input Validation

1. **Sanitize Inputs:**
   - Validate all user inputs
   - Escape special characters
   - Use parameterized queries

2. **Webhook Validation:**
   - Verify HMAC signatures
   - Check timestamp to prevent replay attacks
   - Validate JSON schema

## Logging & Monitoring

### Log Security

1. **Sensitive Data:**
   - Never log passwords or secrets
   - Redact phone numbers if required
   - Hash or encrypt PII in logs

2. **Log Retention:**
   ```javascript
   // config.json
   {
     "logging": {
       "maxFiles": "14d",  // Keep for 14 days
       "maxSize": "20m"    // Rotate at 20MB
     }
   }
   ```

3. **Secure Log Storage:**
   ```bash
   chmod 640 logs/*.log
   chown nodeuser:nodeuser logs/
   ```

### Monitoring

1. **Set Up Alerts:**
   - Failed authentication attempts
   - Rate limit violations
   - Unexpected errors
   - Service downtime

2. **Monitor Resources:**
   - CPU usage
   - Memory usage
   - Disk space
   - Network traffic

3. **Audit Trail:**
   - Log all API calls
   - Track configuration changes
   - Monitor user activities

## Docker Security

### Container Security

1. **Use Official Images:**
   ```dockerfile
   FROM node:18-alpine  # Official, minimal image
   ```

2. **Non-Root User:**
   ```dockerfile
   USER node  # Don't run as root
   ```

3. **Scan for Vulnerabilities:**
   ```bash
   docker scan cti-middleware:latest
   ```

### Docker Compose

1. **Secrets Management:**
   ```yaml
   services:
     app:
       secrets:
         - ami_secret
         - suitecrm_password
   
   secrets:
     ami_secret:
       file: ./secrets/ami_secret.txt
   ```

2. **Network Isolation:**
   ```yaml
   networks:
     cti-network:
       internal: true  # No external access
   ```

## Incident Response

### Security Incident Checklist

1. **Immediate Actions:**
   - [ ] Isolate affected systems
   - [ ] Rotate all credentials
   - [ ] Review logs for breach extent
   - [ ] Notify stakeholders

2. **Investigation:**
   - [ ] Identify attack vector
   - [ ] Assess data exposure
   - [ ] Document timeline
   - [ ] Preserve evidence

3. **Remediation:**
   - [ ] Patch vulnerabilities
   - [ ] Update security rules
   - [ ] Implement additional controls
   - [ ] Test security measures

4. **Post-Incident:**
   - [ ] Conduct post-mortem
   - [ ] Update security policies
   - [ ] Train team on lessons learned
   - [ ] Improve monitoring

### Emergency Contacts

Keep list of contacts for:
- Security team
- System administrators
- FreePBX vendor support
- SuiteCRM support
- Cloud provider support
- Legal team (for compliance)

## Compliance

### Data Protection

1. **GDPR Compliance:**
   - Implement data retention policies
   - Allow data deletion requests
   - Encrypt sensitive data
   - Maintain processing records

2. **PCI-DSS (if applicable):**
   - Never store credit card data
   - Implement network segmentation
   - Regular security audits
   - Encrypt data in transit and at rest

3. **HIPAA (if applicable):**
   - Implement access controls
   - Encrypt all PHI
   - Maintain audit logs
   - Sign BAAs with vendors

### Regular Security Audits

1. **Quarterly Tasks:**
   - Review access controls
   - Update dependencies
   - Rotate credentials
   - Test backup restoration

2. **Annual Tasks:**
   - Penetration testing
   - Security audit
   - Compliance review
   - Disaster recovery test

## Security Checklist

### Deployment

- [ ] All credentials changed from defaults
- [ ] HTTPS enabled with valid certificate
- [ ] Firewall configured
- [ ] Rate limiting enabled
- [ ] Logging configured
- [ ] Monitoring alerts set up
- [ ] Backup system tested
- [ ] Security headers configured
- [ ] CORS properly configured
- [ ] Dependencies updated

### Maintenance

- [ ] Weekly: Review logs for anomalies
- [ ] Weekly: Check for security updates
- [ ] Monthly: Update dependencies
- [ ] Quarterly: Rotate credentials
- [ ] Quarterly: Review access controls
- [ ] Annually: Security audit
- [ ] Annually: Penetration test

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Docker Security](https://docs.docker.com/engine/security/)
- [FreePBX Security](https://wiki.freepbx.org/display/FOP/Security)

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Email security contact with details
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 24 hours and provide timeline for fix.

---

**Security is everyone's responsibility. Stay vigilant!**

