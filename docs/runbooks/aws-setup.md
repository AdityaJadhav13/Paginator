# AWS setup for the pilot (L2.1), step by step with the AWS CLI

Region **ap-south-1 (Mumbai)** for everything (ADR-008). This is a checklist for the owner's AWS account, done once, by
hand, with the AWS CLI v2. There is no Terraform or OpenTofu: their licences (BSL, MPL) are outside the licence list.
Nothing here has been run yet; every command is to run, and to check, on the day.

Values that wait for an owner decision are marked:
- **[D-2]**: the domain and the email sender (docs/product/10-l2-newsroom-plan.md §8.5 item 5);
- **[PITR]**: the RDS backup retention (§8.5 item 9; 14 days by default here);
- **[ALERTS]**: who receives alerts and who is on call (§8.5 item 6);
- **[STANDBY]**: a standby database now, or before the first live night (§8.5 item 3);
- **[D-6]**: the privacy notice and grievance contact for staff accounts (§8.5 item 10), needed before staff sign in.

The fictional `example.test` stands for the domain throughout. Names in `<angle brackets>` are filled in on the day.
Keep the account id, the domain and every address out of the repository (it is public).

```sh
export AWS_REGION=ap-south-1
export PGN_DOMAIN=example.test        # [D-2] the real domain
export ACCOUNT=<12-digit account id>  # never committed
```

## 0. Before starting

- [ ] An AWS account for the pilot; root user with MFA, then an IAM admin user (or IAM Identity Center) with MFA for
  this work. The root user is not used again.
- [ ] Billing alarm: a monthly AWS Budget with email alerts at 80 % and 100 % of the owner's budget
  (§8.5 item 2) to **[ALERTS]**.
- [ ] Ideally the backups bucket lives in a second account (doc 04 §7). This checklist keeps it in the same account,
  under Object Lock; a second account is an owner choice.

## 1. Network: VPC and security groups

- [ ] VPC `10.20.0.0/16` with two public subnets (`10.20.1.0/24` in ap-south-1a, `10.20.2.0/24` in ap-south-1b) and
  two private subnets for RDS (`10.20.11.0/24`, `10.20.12.0/24`); an internet gateway and a route table for the public
  subnets. The compose network of the app host (`10.240.0.0/24`, `PGN_NET_SUBNET`) must not overlap the VPC.

  ```sh
  aws ec2 create-vpc --cidr-block 10.20.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=pgn-pilot}]'
  aws ec2 create-subnet --vpc-id <vpc> --cidr-block 10.20.1.0/24 --availability-zone ap-south-1a
  aws ec2 create-subnet --vpc-id <vpc> --cidr-block 10.20.2.0/24 --availability-zone ap-south-1b
  aws ec2 create-subnet --vpc-id <vpc> --cidr-block 10.20.11.0/24 --availability-zone ap-south-1a
  aws ec2 create-subnet --vpc-id <vpc> --cidr-block 10.20.12.0/24 --availability-zone ap-south-1b
  aws ec2 create-internet-gateway; aws ec2 attach-internet-gateway --internet-gateway-id <igw> --vpc-id <vpc>
  aws ec2 create-route-table --vpc-id <vpc>
  aws ec2 create-route --route-table-id <rt> --destination-cidr-block 0.0.0.0/0 --gateway-id <igw>
  aws ec2 associate-route-table --route-table-id <rt> --subnet-id <public subnet 1a>   # and 1b
  ```

- [ ] Security groups (no SSH from the internet: use SSM Session Manager):

  | Group | Inbound | From |
  |---|---|---|
  | `pgn-app` (app host) | TCP 443, TCP 80 (ACME and the redirect to HTTPS) | 0.0.0.0/0 and ::/0 |
  | `pgn-app` | TCP 8781 (`/healthz` and `/readyz` only, Caddy's health listener) | the `pgn-monitor` group only |
  | `pgn-db` (RDS) | TCP 5432 | the `pgn-app` group only |
  | `pgn-monitor` (Uptime Kuma host) | TCP 443 (its own web UI, over its own Caddy) | the owner's office address only, or nothing (use an SSM port forward) |

  ```sh
  aws ec2 create-security-group --group-name pgn-app --description "Pageinator app host" --vpc-id <vpc>
  aws ec2 authorize-security-group-ingress --group-id <pgn-app> --protocol tcp --port 443 --cidr 0.0.0.0/0
  aws ec2 authorize-security-group-ingress --group-id <pgn-app> --protocol tcp --port 80 --cidr 0.0.0.0/0
  aws ec2 authorize-security-group-ingress --group-id <pgn-app> --protocol tcp --port 8781 --source-group <pgn-monitor>
  aws ec2 authorize-security-group-ingress --group-id <pgn-db> --protocol tcp --port 5432 --source-group <pgn-app>
  ```

  `/healthz` and `/readyz` are not routed by the public site at all (infra/caddy/Caddyfile answers 404); the health
  listener is published on the app host's private address only (`PGN_HEALTH_BIND`), and the group lets in only the
  monitor. **The security group is the health port's only protection:** the listener asks for no password, so never
  open 8781 to a wider source.

## 2. Secrets and settings: SSM Parameter Store

Every setting the pilot compose reads lives under `/pageinator/pilot/` (SecureString for secrets, String for the rest);
`infra/deploy/deploy.sh` writes them to `/etc/pageinator/pilot.env` (root only) on each deploy. Values hold no quote and
no line break (generate secrets as hex: `openssl rand -hex 32`).

```sh
put() { aws ssm put-parameter --name "/pageinator/pilot/$1" --type "$2" --value "$3" --overwrite; }
put PGN_APP_PASSWORD SecureString "$(openssl rand -hex 32)"
```

| Name | Type | Value |
|---|---|---|
| `PGN_REGISTRY` | String | `<account>.dkr.ecr.ap-south-1.amazonaws.com` |
| `PGN_NET_SUBNET`, `PGN_CADDY_IP` | String | `10.240.0.0/24`, `10.240.0.10` |
| `PGN_HEALTH_BIND` | String | the app host's private IP (from step 5) |
| `PGN_DOMAIN` | String | **[D-2]** `example.test` |
| `PGN_APP_ORIGIN` | String | **[D-2]** `https://app.example.test` |
| `PGN_TLS_ISSUER` | String | **[D-2]** the ACME account's email address (Let's Encrypt expiry notices), at the domain |
| `PGN_S3_PUBLIC_ORIGIN` | String | `https://pgn-pilot-work.s3.ap-south-1.amazonaws.com` |
| `PGN_S3_ENDPOINT` | String | `https://s3.ap-south-1.amazonaws.com` |
| `PGN_S3_WORK_BUCKET`, `PGN_S3_ARCHIVE_BUCKET`, `PGN_S3_BACKUPS_BUCKET` | String | `pgn-pilot-work`, `pgn-pilot-archive`, `pgn-pilot-backups` (bucket names are global: add a suffix if taken, and change `PGN_S3_PUBLIC_ORIGIN` to match) |
| `PGN_DB_HOST`, `PGN_DB_NAME` | String | the RDS endpoint (step 4), `pageinator` |
| `PGSSLMODE` | String | `verify-full` |
| `PGN_DB_CA_FILE` | String | `/etc/pageinator/rds-ca.pem` |
| `PGN_SMTP_HOST`, `PGN_SMTP_PORT` | String | `email-smtp.ap-south-1.amazonaws.com`, `587` |
| `PGN_MAIL_FROM` | String | **[D-2]** `Pageinator <no-reply@example.test>` |
| `PGN_APP_PASSWORD`, `PGN_AUTH_PASSWORD`, `PGN_LISTEN_PASSWORD`, `PGN_MIGRATOR_PASSWORD`, `PGN_ENGINE_PASSWORD`, `PGN_BACKUP_PASSWORD` | SecureString | random hex, one each |
| `PGN_AUTH_SECRET` | SecureString | random hex, 64 characters |
| `PGN_S3_ACCESS_KEY_ID`, `PGN_S3_SECRET_ACCESS_KEY` | SecureString | the `pgn-pilot-api` IAM user's key (step 3) |
| `PGN_BACKUP_S3_ACCESS_KEY_ID`, `PGN_BACKUP_S3_SECRET_ACCESS_KEY` | SecureString | the `pgn-pilot-backup` IAM user's key (step 3) |
| `PGN_SMTP_USER`, `PGN_SMTP_PASSWORD` | SecureString | the SES SMTP credentials (step 7) |

Why static keys for S3: the API's settings require a key pair (`PGN_S3_ACCESS_KEY_ID`, `apps/api/src/config.ts`), so it
cannot use the instance role yet. Letting it use the instance role is a small API change (11-fix-before-launch); until
then each key belongs to an IAM user that may do only what the policy below says, and is rotated every 90 days.

## 3. IAM

- [ ] Instance role `pgn-app-host` for the app host, with `AmazonSSMManagedInstanceCore` (Session Manager) and the
  inline policy `infra/aws/iam-app-host-role-policy.json` (read `/pageinator/pilot/*`, pull `pageinator-*` images,
  write the `/pageinator/pilot` log group). Replace `${AWS_ACCOUNT_ID}` first.
- [ ] IAM user `pgn-pilot-api` (no console), policy `infra/aws/iam-api-policy.json` (the work bucket only); one access
  key, into SSM.
- [ ] IAM user `pgn-pilot-backup` (no console), policy `infra/aws/iam-backup-policy.json`: write dumps and their
  retention under `postgres/` in the backups bucket, and read them back (`s3:GetObject`, `s3:GetObjectRetention`: the
  backup checks each dump's checksum and lock after the upload); no list, no delete, no
  `s3:BypassGovernanceRetention`. One access key, into SSM.

The host role needs no KMS permission: the SecureString parameters use the AWS managed key `aws/ssm`, whose key policy
lets the account's principals decrypt through SSM.

```sh
sed "s/\${AWS_ACCOUNT_ID}/$ACCOUNT/g" infra/aws/iam-app-host-role-policy.json > /tmp/host-policy.json
aws iam create-role --role-name pgn-app-host --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name pgn-app-host --policy-name pgn-app-host --policy-document file:///tmp/host-policy.json
aws iam attach-role-policy --role-name pgn-app-host --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name pgn-app-host
aws iam add-role-to-instance-profile --instance-profile-name pgn-app-host --role-name pgn-app-host
```

## 4. RDS Postgres 18

- [ ] Check the minor versions on offer: `aws rds describe-db-engine-versions --engine postgres --query "DBEngineVersions[?starts_with(EngineVersion,'18')].EngineVersion"`.
  Use the newest 18.x (the images' pg_dump is 18.6; it dumps any 18.x).
- [ ] A DB subnet group of the two private subnets; a parameter group from `postgres18` with `rds.force_ssl = 1`.
- [ ] The instance: `db.t4g.small` (or what the budget allows), 20 GB gp3, storage encrypted, not publicly accessible,
  in `pgn-db`, automated backups with **[PITR]** 14 days (`--backup-retention-period 14`; 1–35 allowed), deletion
  protection on, Performance Insights off (cost), **[STANDBY]** `--no-multi-az` unless the owner wants a standby now.

  ```sh
  aws rds create-db-instance --db-instance-identifier pgn-pilot --engine postgres --engine-version <18.x> \
    --db-instance-class db.t4g.small --allocated-storage 20 --storage-type gp3 --storage-encrypted \
    --master-username pgn_master --manage-master-user-password --db-subnet-group-name pgn-pilot \
    --vpc-security-group-ids <pgn-db> --no-publicly-accessible --backup-retention-period 14 \
    --deletion-protection --db-parameter-group-name pgn-pilot-pg18 --no-multi-az
  ```

- [ ] The roles and rights, once, from the app host (step 5) as the master user, with the passwords from SSM in the
  environment: `infra/docker/postgres-init.sql` (the roles of plan §3.1, as in development), then
  `infra/docker/backup-role.sql` (pgn_backup: BYPASSRLS, read-only by default, at most 2 connections). Both read
  `POSTGRES_DB` and the `PGN_*_PASSWORD` values with `\getenv`; the container gets those and nothing else from
  `pilot.env` (no S3 key, no sign-in secret). The master user's password is the one RDS keeps in Secrets Manager
  (`--manage-master-user-password`); read it with the admin's credentials, not the instance role's (which may not). **To verify on the instance:** that the RDS master user may give BYPASSRLS and
  `pg_read_all_data` (if not, the dump runs as a role that owns the tables, which FORCE ROW LEVEL SECURITY then
  filters: pg_dump stops with an error rather than dump less).

  ```sh
  secret=$(aws rds describe-db-instances --db-instance-identifier pgn-pilot \
    --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
  export PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id "$secret" --query SecretString --output text |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["password"])')
  roles=$(sudo grep -E '^PGN_(MIGRATOR|APP|AUTH|ENGINE|LISTEN|BACKUP)_PASSWORD=' /etc/pageinator/pilot.env | sed "s/'//g")
  for f in postgres-init.sql backup-role.sql; do
    docker run --rm -i --env-file <(printf '%s\n' "$roles") -e PGPASSWORD -e POSTGRES_DB=pageinator \
      -e PGSSLMODE=verify-full -e PGSSLROOTCERT=/ca.pem -v /etc/pageinator/rds-ca.pem:/ca.pem:ro \
      postgres@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336 \
      psql "host=<endpoint> dbname=pageinator user=pgn_master" -v ON_ERROR_STOP=1 -f - < infra/docker/$f
  done
  unset PGPASSWORD roles
  ```

- [ ] The RDS certificate bundle on the app host, at `/etc/pageinator/rds-ca.pem` (from AWS's trust store page for
  ap-south-1; check its fingerprint against the page).

## 5. EC2 app host, with an Elastic IP

- [ ] `t3.small` (x86_64; 2 GB) or larger, Ubuntu 24.04 LTS or Amazon Linux 2023, 30 GB gp3 encrypted, in a public
  subnet, groups `pgn-app`, instance profile `pgn-app-host`. The instance metadata service: IMDSv2 only, **with a hop
  limit of 1** (`--metadata-options HttpTokens=required,HttpPutResponseHopLimit=1,HttpEndpoint=enabled`). The
  containers sit one hop behind the host (Docker's bridge), so with a hop limit of 1 they never get a metadata token,
  and so never the instance role's credentials (SSM, ECR, logs). Amazon Linux 2023 images default to a hop limit of 2,
  which would let them. For an instance that already exists:

  ```sh
  aws ec2 modify-instance-metadata-options --instance-id <instance> --http-tokens required \
    --http-put-response-hop-limit 1 --http-endpoint enabled
  ```

  Check it after the first deploy (`deploy.md`, "Check": the token request from inside the API container must fail).
  This is verified only on the real host: pilot-local has no instance metadata service, so nothing there shows it.
- [ ] An Elastic IP, associated with it.
- [ ] Docker Engine and the compose plugin from Docker's own repository, the AWS CLI v2; automatic security updates on.
- [ ] Docker log rotation does not apply to awslogs; CloudWatch keeps the logs (step 9).
- [ ] `/etc/pageinator/` (root, 0700) for `pilot.env` and `rds-ca.pem`; the repository's `infra/` folder checked out
  at the deployed commit (deploy.sh and the compose file), for example in `/opt/pageinator`.
- [ ] Disk alarm: the CloudWatch agent's `disk_used_percent` above 80 % (step 10).

## 6. S3 buckets

Three buckets: work (uploads, photos), archive (L2.5; created now so its Object Lock is on from the start), backups.

```sh
for b in pgn-pilot-work pgn-pilot-archive pgn-pilot-backups; do
  case $b in *work) lock= ;; *) lock=--object-lock-enabled-for-bucket ;; esac
  aws s3api create-bucket --bucket $b --create-bucket-configuration LocationConstraint=ap-south-1 $lock
  aws s3api put-public-access-block --bucket $b --public-access-block-configuration file://infra/aws/s3-public-access-block.json
  aws s3api put-bucket-versioning --bucket $b --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket $b --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
  sed "s/\${BUCKET}/$b/g" infra/aws/s3-tls-only-policy.json > /tmp/policy.json
  aws s3api put-bucket-policy --bucket $b --policy file:///tmp/policy.json
  aws s3api put-bucket-ownership-controls --bucket $b --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
done
aws s3api put-bucket-lifecycle-configuration --bucket pgn-pilot-work --lifecycle-configuration file://infra/aws/s3-work-lifecycle.json
aws s3api put-object-lock-configuration --bucket pgn-pilot-backups --object-lock-configuration file://infra/aws/s3-backups-object-lock.json
aws s3api put-bucket-lifecycle-configuration --bucket pgn-pilot-backups --lifecycle-configuration file://infra/aws/s3-backups-lifecycle.json
sed "s/\${PGN_DOMAIN}/$PGN_DOMAIN/g" infra/aws/s3-cors.json > /tmp/cors.json     # [D-2]
aws s3api put-bucket-cors --bucket pgn-pilot-work --cors-configuration file:///tmp/cors.json
```

- Work bucket: versioning, the uploads/ rules (`UPLOADS_LIFECYCLE` in `apps/api/src/storage/s3.ts`; a test keeps the
  JSON equal to it), noncurrent versions removed after 30 days (plan §6.1), TLS 1.2+ only, public access blocked,
  and a CORS rule for exactly `https://app.<domain>`: POST and GET, no header, nothing exposed, 10 minutes. The archive
  and backups buckets get no CORS rule.
- Backups bucket: Object Lock in governance mode, each dump kept 35 days (the default retention, and the backup
  script sets it on each dump too), then expired at 36 days.
- Archive bucket: Object Lock enabled; its default retention waits for the owner (§8.5 item 9) and L2.5.
- [ ] Check what S3 itself does that SeaweedFS was only trusted for (plan §6.5, "one staging check on real S3"): the
  POST policy conditions, the checksum, the CORS headers on a refused upload (403 and 400), and that a preflight
  asking for a header (`X-Pageinator`) is refused (SeaweedFS 4.48 allowed one; S3 should not, with no AllowedHeaders).

## 7. SES: email from the domain, out of the sandbox

- [ ] **[D-2]** Verify the domain identity with Easy DKIM (three CNAME records), a custom MAIL FROM domain
  (`mail.example.test`: an MX record and an SPF TXT record `v=spf1 include:amazonses.com -all`), and a DMARC record
  `_dmarc.example.test TXT "v=DMARC1; p=quarantine; rua=mailto:<[ALERTS] address>"` (start at `p=none` for two weeks if
  the domain already sends other mail).

  ```sh
  aws sesv2 create-email-identity --email-identity $PGN_DOMAIN
  aws sesv2 put-email-identity-mail-from-attributes --email-identity $PGN_DOMAIN --mail-from-domain mail.$PGN_DOMAIN
  ```

- [ ] SMTP credentials: an IAM user `pgn-pilot-ses` with `ses:SendRawEmail` on the identity only; its SMTP password
  derived as AWS documents; both into SSM.
- [ ] Leave the sandbox: `aws sesv2 put-account-details --production-access-enabled --mail-type TRANSACTIONAL
  --website-url https://app.example.test --use-case-description "Sign-in emails for one newspaper's staff (about 20 people)"`
  (**[D-2]**). Until AWS agrees, mail reaches verified addresses only.
- [ ] A configuration set with bounce and complaint events to SNS (step 10).

## 8. ECR (x86_64 images)

```sh
for r in pageinator-api pageinator-web pageinator-backup; do
  aws ecr create-repository --repository-name $r --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true
  aws ecr put-lifecycle-policy --repository-name $r --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":20},"action":{"type":"expire"}}]}'
done
```

Images are built for `linux/amd64` (`docker buildx build --platform linux/amd64`), tagged with the commit id, from
`infra/docker/api.Dockerfile` (the API, and `--target backup`) and `infra/docker/web.Dockerfile`. Tags are immutable,
so a rollback always finds the image it ran before.

## 9. CloudWatch logs (30 days)

```sh
aws logs create-log-group --log-group-name /pageinator/pilot
aws logs put-retention-policy --log-group-name /pageinator/pilot --retention-in-days 30
```

The compose file sends every container's log there (awslogs, non-blocking), one stream per container. The API logs
JSON lines (pino) and no story text at info level.

## 10. Alarms to SNS

- [ ] An SNS topic `pgn-pilot-alerts`, with email subscriptions for **[ALERTS]** (the owner and the person on call).
- [ ] Metric filters on `/pageinator/pilot`, each with an alarm to the topic:
  - `"backup failed:"` (count ≥ 1 in 5 minutes);
  - `"backup done:"` missing for 26 hours (alarm on missing data, `treat-missing-data breaching`);
  - API errors: `{ $.level >= 50 }` more than 5 in 5 minutes.
- [ ] EC2 status check failed, and `disk_used_percent > 80` (the CloudWatch agent).
- [ ] RDS: `FreeStorageSpace < 2 GB`, `CPUUtilization > 80 %` for 15 minutes.
- [ ] Uptime Kuma (step 11) also sends to the same people.

```sh
aws sns create-topic --name pgn-pilot-alerts
aws sns subscribe --topic-arn <topic> --protocol email --notification-endpoint <[ALERTS] address>
aws logs put-metric-filter --log-group-name /pageinator/pilot --filter-name backup-failed \
  --filter-pattern '"backup failed:"' --metric-transformations metricName=BackupFailed,metricNamespace=Pageinator,metricValue=1
aws cloudwatch put-metric-alarm --alarm-name pgn-backup-failed --namespace Pageinator --metric-name BackupFailed \
  --statistic Sum --period 300 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching --alarm-actions <topic>
```

## 11. Uptime Kuma 2.5.6 (MIT) on a small host

- [ ] A `t4g.nano` in the other public subnet (ap-south-1b), group `pgn-monitor`, IMDSv2 only, its own Elastic IP,
  Docker. Uptime Kuma `louislam/uptime-kuma:2.5.6@sha256:9912da7d7d9b6ddc0c2d904beb84d24689c1ed9c33b81419eb9008663a92a329`,
  its UI on 127.0.0.1 only (reach it through an SSM port forward), data in a volume.
- [ ] Monitors (every 60 s, alert after 2 failures, to **[ALERTS]** by email or another channel the owner picks):
  - `http://<app host private IP>:8781/healthz` (keyword `"ok"`);
  - `http://<app host private IP>:8781/readyz` (keyword `"ready"`; the database and the work bucket);
  - `https://app.example.test/` (**[D-2]**; status 200), with the certificate-expiry notice at 14 days;
  - from L2.2: the worker heartbeat and the queue age (plan §8.4).
- [ ] It lives in the same account and region, so it does not see a region-wide outage; a second check from outside
  AWS is an owner choice.

## 12. DNS and the first deploy

- [ ] **[D-2]** `app.example.test A <Elastic IP>`, TTL 300, and **no AAAA record**: an IPv6 client would reach the
  API as Docker's bridge address, so every IPv6 client would share one rate-limit budget (11-fix-before-launch
  L2-287). A CAA record `example.test CAA 0 issue "letsencrypt.org"`.
- [ ] **[D-6]** The privacy notice and grievance contact are published before the first staff account is made.
- [ ] Deploy: `docs/runbooks/deploy.md`. Then `node tools/ts/check-headers.ts https://app.example.test` from any machine,
  and the restore drill (`docs/runbooks/restore.md`) within the first week.
