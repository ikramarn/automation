# Helm Deployment — AI Video Automation SaaS

## Prerequisites

- Kubernetes cluster with `automation` namespace created
- `helm` v3.x installed on the Jenkins VM and your local machine
- `kubectl` configured with kubeconfig access to the cluster
- nginx-ingress-controller installed in the cluster
- A container registry (Docker Hub, GHCR, ECR, etc.)

---

## 1. Create the K8s Secret (one-time, per environment)

The Helm chart does NOT manage secrets — it references a pre-existing Secret named `automation-secrets`.

Copy `.env.example` to `.env.prod`, fill in all real values, then:

```bash
kubectl create secret generic automation-secrets \
  --namespace automation \
  --from-env-file=.env.prod
```

**Never commit `.env.prod`.**  
To update a secret value later: `kubectl edit secret automation-secrets -n automation`  
or delete and recreate: `kubectl delete secret automation-secrets -n automation && kubectl create ...`

---

## 2. Configure values-prod.yaml

Edit `helm/automation/values-prod.yaml`:
- Set `global.registry` to your actual registry (e.g. `ghcr.io/your-org`)
- Set `ingress.host` to your real domain
- Set `ingress.tls.enabled: true` and `ingress.tls.secretName` if using HTTPS
- Set `dashboard.buildArgs.*` to match what the dashboard image was built with

---

## 3. Deploy manually (first time or emergency)

```bash
# Lint first
helm lint ./helm/automation -f helm/automation/values-prod.yaml

# Deploy (or upgrade)
helm upgrade --install automation ./helm/automation \
  --namespace automation \
  --values helm/automation/values-prod.yaml \
  --set global.imageTag=<git-sha-or-tag> \
  --atomic \
  --timeout 5m \
  --wait
```

---

## 4. Jenkins setup

### Required credentials (Jenkins → Manage Credentials → Global)

| Credential ID               | Type          | Value                                      |
|-----------------------------|---------------|--------------------------------------------|
| `REGISTRY_CREDENTIALS`      | Username/Pass | Registry username + password/token         |
| `KUBECONFIG_SECRET`         | Secret file   | `~/.kube/config` for the target cluster    |
| `NEXT_PUBLIC_SUPABASE_URL`  | Secret text   | Your Supabase project URL                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Secret text | Your Supabase anon key                  |
| `NEXT_PUBLIC_API_BASE_URL`  | Secret text   | e.g. `https://app.yourdomain.com/api`      |

### Required global env vars (Jenkins → Manage Jenkins → Configure System)

| Variable   | Example                  |
|------------|--------------------------|
| `REGISTRY` | `ghcr.io/your-org`       |

### Required tools (Jenkins → Manage Jenkins → Global Tool Configuration)

- **Node.js**: Install Node 20 LTS, name it `node-20`
- **Docker**: Must be installed on the Jenkins agent VM
- **Helm**: Must be installed on the Jenkins agent VM (`helm` in PATH)
- **kubectl**: Must be installed on the Jenkins agent VM

---

## 5. Rollback

```bash
# List releases
helm history automation -n automation

# Rollback to previous revision
helm rollback automation -n automation

# Rollback to a specific revision
helm rollback automation 3 -n automation
```

---

## 6. Checking deployment status

```bash
# All pods in namespace
kubectl get pods -n automation

# Logs
kubectl logs -l app=automation-api -n automation --tail=100
kubectl logs -l app=automation-n8n -n automation --tail=100

# Exec into a pod
kubectl exec -it deploy/automation-api -n automation -- sh
```

---

## Architecture in K8s

```
Internet
    │
    ▼
[Ingress (nginx-ingress-controller)]
    │
    ├── /api/*  ──► [automation-api Service] ──► [API Pods] ──► Supabase / Stripe / Resend
    │                                                 │
    │                                                 └──► [automation-n8n Service] (internal)
    │                                                             │
    │                                                             └──► [automation-redis Service] (internal)
    │
    └── /*      ──► [automation-dashboard Service] ──► [Dashboard Pods]
```

n8n and Redis are **never** reachable from the Ingress — ClusterIP only.
