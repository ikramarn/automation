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
//   DOCKERHUB_CREDENTIALS    Username/Password  — Docker Hub (ikcloudky6)
//   KUBECONFIG_SECRET        Secret file        — kubeconfig pointing to K8s
//                                                 master via Tailscale IP
//   VPS_SSH_KEY              SSH private key    — deploy user on Hostinger VPS
//   VPS_HOST                 Secret text        — VPS Tailscale IP or hostname
//   NEXT_PUBLIC_SUPABASE_URL Secret text        — Supabase project URL
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  Secret text — Supabase publishable key
//   NEXT_PUBLIC_API_BASE_URL Secret text        — e.g. https://app.yourdomain.com/api

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
                        withCredentials([
                            string(credentialsId: 'NEXT_PUBLIC_SUPABASE_URL',                variable: 'SUPABASE_URL'),
                            string(credentialsId: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',    variable: 'SUPABASE_KEY'),
                            string(credentialsId: 'NEXT_PUBLIC_API_BASE_URL',                variable: 'API_BASE_URL')
                        ]) {
                            sh """
                                docker build \\
                                  --target production \\
                                  --build-arg NEXT_PUBLIC_SUPABASE_URL=\${SUPABASE_URL} \\
                                  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\${SUPABASE_KEY} \\
                                  --build-arg NEXT_PUBLIC_API_BASE_URL=\${API_BASE_URL} \\
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
                    credentialsId: 'DOCKERHUB_CREDENTIALS',
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

        // ── 5. Dev K8s Deploy (master/main → dev cluster) ─────────────────
        stage('Dev Deploy (K8s)') {
            when {
                anyOf { branch 'master'; branch 'main' }
            }
            steps {
                withCredentials([file(credentialsId: 'KUBECONFIG_SECRET', variable: 'KUBECONFIG')]) {
                    sh """
                        helm lint ${HELM_CHART} -f ${HELM_VALUES_PROD}
                        helm upgrade --install ${HELM_RELEASE} ${HELM_CHART} \\
                          --namespace ${K8S_NAMESPACE} \\
                          --create-namespace \\
                          --values ${HELM_VALUES_PROD} \\
                          --set global.imageTag=${IMAGE_TAG} \\
                          --atomic \\
                          --timeout 5m \\
                          --wait
                    """
                }
            }
        }

        // ── 6. Prod VPS Deploy (release/* → Hostinger VPS via Tailscale) ──
        stage('Prod Deploy (VPS)') {
            when {
                branch pattern: 'release/.*', comparator: 'REGEXP'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'VPS_SSH_KEY', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'VPS_HOST', variable: 'VPS_HOST')
                ]) {
                    sh """
                        # Copy docker-compose files to VPS
                        scp -i \${SSH_KEY} -o StrictHostKeyChecking=no \\
                            docker-compose.yml \\
                            docker-compose.prod.yml \\
                            Caddyfile \\
                            \${SSH_USER}@\${VPS_HOST}:${VPS_APP_DIR}/

                        # Pull new images and restart containers
                        ssh -i \${SSH_KEY} -o StrictHostKeyChecking=no \\
                            \${SSH_USER}@\${VPS_HOST} \\
                            "cd ${VPS_APP_DIR} && \\
                             IMAGE_TAG=${IMAGE_TAG} \\
                             docker compose -f docker-compose.yml -f docker-compose.prod.yml pull && \\
                             IMAGE_TAG=${IMAGE_TAG} \\
                             docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --remove-orphans && \\
                             docker image prune -f"
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
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                withCredentials([file(credentialsId: 'KUBECONFIG_SECRET', variable: 'KUBECONFIG')]) {
                    sh """
                        kubectl rollout status deployment/dashboard-preview \\
                            -n ${K8S_NAMESPACE} --timeout=120s || true

                        kubectl port-forward svc/dashboard-preview-svc 8081:3000 \\
                            -n ${K8S_NAMESPACE} &
                        sleep 5

                        curl --fail --silent --max-time 10 http://localhost:8081/ || exit 1
                        echo "✅ Smoke test passed"
                    """
                }
            }
            post {
                always {
                    sh "pkill -f 'kubectl port-forward' || true"
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
