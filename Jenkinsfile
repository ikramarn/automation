// ── AI Video Automation SaaS — Jenkinsfile ───────────────────────────────────
//
// Pipeline stages:
//   1. Checkout       — pull source from GitHub
//   2. Test           — run unit + property-based tests across all projects
//   3. Build Images   — docker build --target production for api + dashboard
//   4. Push Images    — push tagged images to Docker Hub (ikcloudky6/automation)
//   5. Helm Deploy    — deploy to dev K8s cluster via Tailscale kubeconfig
//   6. VPS Deploy     — SSH deploy to prod VPS via Tailscale (release/* branch)
//   7. Smoke Test     — verify /health endpoints post-deploy
//
// ── Jenkins Credentials Required ─────────────────────────────────────────────
// Configure in Jenkins → Manage Credentials → Global:
//
//   docker-hub               Username/Password  — Docker Hub (ikcloudky6)
//   KUBECONFIG_SECRET        Secret file        — kubeconfig pointing to K8s
//                                                 master via Tailscale IP
//   VPS_SSH_KEY              SSH private key    — deploy user on Hostinger VPS
//   VPS_HOST                 Secret text        — VPS Tailscale IP or hostname
//   DASHBOARD_BUILD_ENV      Secret file        — .env file containing:
//                                                   NEXT_PUBLIC_SUPABASE_URL
//                                                   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//                                                   NEXT_PUBLIC_API_BASE_URL

pipeline {
    agent any

    tools {
        nodejs 'node-20'   // Node.js 20 LTS — configure in Global Tool Configuration
    }

    environment {
        REGISTRY         = 'ikcloudky6/automation'
        API_IMAGE        = "${REGISTRY}"
        DASHBOARD_IMAGE  = "${REGISTRY}"
        IMAGE_TAG        = "${env.GIT_COMMIT?.take(8) ?: 'latest'}"
        HELM_RELEASE     = 'automation'
        K8S_NAMESPACE    = 'automation'
        HELM_CHART       = './helm/automation'
        HELM_VALUES_PROD = './helm/automation/values-prod.yaml'
        VPS_APP_DIR      = '/opt/autoflow'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 40, unit: 'MINUTES')
        disableConcurrentBuilds()
        timestamps()
    }

    stages {

        // ── 1. Checkout ────────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                echo "Building commit ${IMAGE_TAG} on branch ${env.BRANCH_NAME}"
            }
        }

        // ── 2. Test ────────────────────────────────────────────────────────
        stage('Test') {
            parallel {

                stage('API Tests') {
                    steps {
                        dir('api') {
                            sh 'npm ci'
                            sh 'npm run lint'
                            sh 'npm test'
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'api/test-results/**/*.xml'
                        }
                    }
                }

                stage('Dashboard Tests') {
                    steps {
                        dir('dashboard') {
                            sh 'npm ci --legacy-peer-deps'
                            sh 'npm run lint'
                            sh 'npm test'
                        }
                    }
                }

                stage('Pipeline Engine Tests') {
                    steps {
                        dir('n8n') {
                            sh '''
                                if [ -f package.json ]; then
                                    npm ci
                                    npm test
                                else
                                    echo "No n8n package.json — skipping"
                                fi
                            '''
                        }
                    }
                }

            }
        }

        // ── 3. Build Images ────────────────────────────────────────────────
        stage('Build Images') {
            when {
                anyOf {
                    branch 'master'
                    branch 'main'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            parallel {

                stage('Build API Image') {
                    steps {
                        sh """
                            docker build \\
                              --target production \\
                              --tag ${REGISTRY}:api-${IMAGE_TAG} \\
                              --tag ${REGISTRY}:api-latest \\
                              --cache-from ${REGISTRY}:api-latest \\
                              ./api
                        """
                    }
                }

                stage('Build Dashboard Image') {
                    steps {
                        withCredentials([file(credentialsId: 'DASHBOARD_BUILD_ENV', variable: 'DASHBOARD_ENV_FILE')]) {
                            sh """
                                # Source the env file to get build args
                                set -a && . \${DASHBOARD_ENV_FILE} && set +a
                                docker build \\
                                  --target production \\
                                  --build-arg NEXT_PUBLIC_SUPABASE_URL=\${NEXT_PUBLIC_SUPABASE_URL} \\
                                  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY} \\
                                  --build-arg NEXT_PUBLIC_API_BASE_URL=\${NEXT_PUBLIC_API_BASE_URL} \\
                                  --tag ${REGISTRY}:dashboard-${IMAGE_TAG} \\
                                  --tag ${REGISTRY}:dashboard-latest \\
                                  --cache-from ${REGISTRY}:dashboard-latest \\
                                  ./dashboard
                            """
                        }
                    }
                }

            }
        }

        // ── 4. Push Images ─────────────────────────────────────────────────
        stage('Push Images') {
            when {
                anyOf {
                    branch 'master'
                    branch 'main'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'docker-hub',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh "echo \${DOCKER_PASS} | docker login -u \${DOCKER_USER} --password-stdin"
                    sh "docker push ${REGISTRY}:api-${IMAGE_TAG}"
                    sh "docker push ${REGISTRY}:api-latest"
                    sh "docker push ${REGISTRY}:dashboard-${IMAGE_TAG}"
                    sh "docker push ${REGISTRY}:dashboard-latest"
                }
            }
            post {
                always {
                    sh "docker logout || true"
                }
            }
        }

        // ── 5. Dev K8s Deploy — SKIPPED (no K8s cluster) ─────────────────
        // stage('Dev Deploy (K8s)') { ... }

        // ── 6. Prod VPS Deploy (master/main → VPS via SSH) ────────────────
        stage('Prod Deploy (VPS)') {
            when {
                anyOf { branch 'master'; branch 'main' }
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'VPS_SSH_KEY', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'VPS_HOST', variable: 'VPS_HOST'),
                    file(credentialsId: 'DASHBOARD_BUILD_ENV', variable: 'DASHBOARD_ENV_FILE')
                ]) {
                    sh """
                        # Copy the deploy script to VPS and execute it
                        scp -i \${SSH_KEY} -o StrictHostKeyChecking=no \\
                            scripts/vps-deploy.sh \\
                            \${SSH_USER}@\${VPS_HOST}:/tmp/vps-deploy.sh

                        ssh -i \${SSH_KEY} -o StrictHostKeyChecking=no \\
                            \${SSH_USER}@\${VPS_HOST} \\
                            "chmod +x /tmp/vps-deploy.sh && IMAGE_TAG=${IMAGE_TAG} REGISTRY=${REGISTRY} bash /tmp/vps-deploy.sh"
                    """
                }
            }
        }

        // ── 7. Smoke Test ──────────────────────────────────────────────────
        stage('Smoke Test') {
            when {
                anyOf {
                    branch 'master'
                    branch 'main'
                }
            }
            steps {
                withCredentials([string(credentialsId: 'VPS_HOST', variable: 'VPS_HOST')]) {
                    sh """
                        echo "Waiting 15s for containers to stabilise..."
                        sleep 15
                        curl --fail --silent --max-time 15 https://automatesocials.tech/api/health || exit 1
                        echo "✅ Smoke test passed — /api/health returned 200"
                    """
                }
            }
        }

    }

    post {
        success {
            echo "✅ Pipeline succeeded — ${IMAGE_TAG} deployed"
        }
        failure {
            echo "❌ Pipeline failed — check logs above"
        }
        cleanup {
            sh "docker system prune -f --filter 'until=24h' || true"
        }
    }
}
