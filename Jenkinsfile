// ── AI Video Automation SaaS — Jenkinsfile ───────────────────────────────────
//
// Pipeline stages:
//   1. Checkout       — pull source from GitHub
//   2. Test           — run unit + property-based tests across all projects
//   3. Build Images   — docker build --target production for api + dashboard
//   4. Push Images    — push to container registry with git-SHA tag
//   5. Helm Lint      — validate Helm chart templates
//   6. Deploy         — helm upgrade --install to the automation namespace
//   7. Smoke Test     — verify /health endpoints post-deploy
//
// Jenkins credentials required (configure in Jenkins → Manage Credentials):
//   REGISTRY_CREDENTIALS  — Username/password for your container registry
//   KUBECONFIG_SECRET     — Secret file containing kubeconfig for the K8s cluster
//
// Environment variables to configure in Jenkins → Pipeline job → Build parameters
// or as Jenkins global env vars:
//   REGISTRY             — e.g. ghcr.io/your-org  or  docker.io/youruser
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_BASE_URL
//     (needed at docker build time for the dashboard image)

pipeline {
    agent any

    // ── Tool versions — must be configured in Jenkins → Global Tool Configuration
    tools {
        nodejs 'node-20'     // Node.js 20 LTS installation name
    }

    environment {
        // Container registry — override in Jenkins global env or job parameter
        REGISTRY         = "${env.REGISTRY ?: 'ghcr.io/your-org'}"

        // Image names
        API_IMAGE        = "${REGISTRY}/ai-video-automation-api"
        DASHBOARD_IMAGE  = "${REGISTRY}/ai-video-automation-dashboard"

        // Tag every image with the short git SHA for traceability + rollback
        IMAGE_TAG        = "${env.GIT_COMMIT?.take(8) ?: 'latest'}"

        // Helm / K8s
        HELM_RELEASE     = 'automation'
        K8S_NAMESPACE    = 'automation'
        HELM_CHART       = './helm/automation'
        HELM_VALUES_PROD = './helm/automation/values-prod.yaml'

        // Registry credential ID (Jenkins credential store)
        REGISTRY_CRED_ID = 'REGISTRY_CREDENTIALS'
    }

    options {
        // Keep last 10 builds
        buildDiscarder(logRotator(numToKeepStr: '10'))
        // Fail if pipeline hangs for more than 30 min
        timeout(time: 30, unit: 'MINUTES')
        // Don't run concurrent builds on the same branch
        disableConcurrentBuilds()
        timestamps()
    }

    stages {

        // ── 1. Checkout ────────────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                echo "Building commit ${IMAGE_TAG} on branch ${env.BRANCH_NAME}"
            }
        }

        // ── 2. Test ────────────────────────────────────────────────────────────
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
                            // Publish vitest results if junit reporter is configured
                            junit allowEmptyResults: true, testResults: 'api/test-results/**/*.xml'
                        }
                    }
                }

                stage('Dashboard Tests') {
                    steps {
                        dir('dashboard') {
                            sh 'npm ci'
                            sh 'npm run lint'
                            sh 'npm test'
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'dashboard/test-results/**/*.xml'
                        }
                    }
                }

                stage('Pipeline Engine Tests') {
                    steps {
                        dir('n8n') {
                            // Only run if n8n has a package.json / test script
                            sh '''
                                if [ -f package.json ]; then
                                    npm ci
                                    npm test
                                else
                                    echo "No n8n package.json found, skipping"
                                fi
                            '''
                        }
                    }
                }

            }
        }

        // ── 3. Build Images ────────────────────────────────────────────────────
        // Only build + push on main/master or release branches
        stage('Build Images') {
            when {
                anyOf {
                    branch 'main'
                    branch 'master'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            parallel {

                stage('Build API Image') {
                    steps {
                        sh """
                            docker build \
                              --target production \
                              --tag ${API_IMAGE}:${IMAGE_TAG} \
                              --tag ${API_IMAGE}:latest \
                              --cache-from ${API_IMAGE}:latest \
                              ./api
                        """
                    }
                }

                stage('Build Dashboard Image') {
                    steps {
                        // Next.js public env vars are baked in at build time
                        withCredentials([
                            string(credentialsId: 'NEXT_PUBLIC_SUPABASE_URL',      variable: 'SUPABASE_URL'),
                            string(credentialsId: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', variable: 'SUPABASE_ANON_KEY'),
                            string(credentialsId: 'NEXT_PUBLIC_API_BASE_URL',      variable: 'API_BASE_URL')
                        ]) {
                            sh """
                                docker build \
                                  --target production \
                                  --build-arg NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL} \
                                  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY} \
                                  --build-arg NEXT_PUBLIC_API_BASE_URL=${API_BASE_URL} \
                                  --tag ${DASHBOARD_IMAGE}:${IMAGE_TAG} \
                                  --tag ${DASHBOARD_IMAGE}:latest \
                                  --cache-from ${DASHBOARD_IMAGE}:latest \
                                  ./dashboard
                            """
                        }
                    }
                }

            }
        }

        // ── 4. Push Images ─────────────────────────────────────────────────────
        stage('Push Images') {
            when {
                anyOf {
                    branch 'main'
                    branch 'master'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: "${REGISTRY_CRED_ID}",
                    usernameVariable: 'REGISTRY_USER',
                    passwordVariable: 'REGISTRY_PASS'
                )]) {
                    sh "echo ${REGISTRY_PASS} | docker login ${REGISTRY} -u ${REGISTRY_USER} --password-stdin"

                    sh "docker push ${API_IMAGE}:${IMAGE_TAG}"
                    sh "docker push ${API_IMAGE}:latest"

                    sh "docker push ${DASHBOARD_IMAGE}:${IMAGE_TAG}"
                    sh "docker push ${DASHBOARD_IMAGE}:latest"
                }
            }
            post {
                always {
                    // Always logout — never leave registry credentials on the agent
                    sh "docker logout ${REGISTRY} || true"
                }
            }
        }

        // ── 5. Helm Lint ───────────────────────────────────────────────────────
        stage('Helm Lint') {
            when {
                anyOf {
                    branch 'main'
                    branch 'master'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                sh "helm lint ${HELM_CHART} -f ${HELM_VALUES_PROD}"
            }
        }

        // ── 6. Deploy ──────────────────────────────────────────────────────────
        stage('Deploy') {
            when {
                anyOf {
                    branch 'main'
                    branch 'master'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                // KUBECONFIG_SECRET is a Jenkins "Secret file" credential
                // containing the kubeconfig for the target cluster
                withCredentials([file(credentialsId: 'KUBECONFIG_SECRET', variable: 'KUBECONFIG')]) {
                    sh """
                        helm upgrade --install ${HELM_RELEASE} ${HELM_CHART} \
                          --namespace ${K8S_NAMESPACE} \
                          --create-namespace \
                          --values ${HELM_VALUES_PROD} \
                          --set global.imageTag=${IMAGE_TAG} \
                          --atomic \
                          --timeout 5m \
                          --wait
                    """
                }
            }
        }

        // ── 7. Smoke Test ──────────────────────────────────────────────────────
        stage('Smoke Test') {
            when {
                anyOf {
                    branch 'main'
                    branch 'master'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                withCredentials([file(credentialsId: 'KUBECONFIG_SECRET', variable: 'KUBECONFIG')]) {
                    sh """
                        # Wait for pods to be ready (helm --atomic already waits, this is a safety check)
                        kubectl rollout status deployment/automation-api       -n ${K8S_NAMESPACE} --timeout=120s
                        kubectl rollout status deployment/automation-dashboard -n ${K8S_NAMESPACE} --timeout=120s

                        # Hit health endpoints via port-forward (works even without external DNS)
                        kubectl port-forward svc/automation-api       8081:3001 -n ${K8S_NAMESPACE} &
                        kubectl port-forward svc/automation-dashboard 8080:3000 -n ${K8S_NAMESPACE} &
                        sleep 5

                        curl --fail --silent --max-time 10 http://localhost:8081/health        || exit 1
                        curl --fail --silent --max-time 10 http://localhost:8080/api/health    || exit 1

                        echo "✅ All smoke tests passed"
                    """
                }
            }
            post {
                always {
                    // Kill port-forwards regardless of test outcome
                    sh "pkill -f 'kubectl port-forward' || true"
                }
            }
        }

    }

    // ── Post-pipeline notifications ────────────────────────────────────────────
    post {
        success {
            echo "✅ Pipeline succeeded — ${IMAGE_TAG} deployed to namespace ${K8S_NAMESPACE}"
        }
        failure {
            echo "❌ Pipeline failed — check logs above"
            // Add Slack/email notification here if needed:
            // slackSend channel: '#deployments', message: "Build failed: ${env.JOB_NAME} ${env.BUILD_NUMBER}"
        }
        unstable {
            echo "⚠️ Pipeline unstable — some tests may have failed"
        }
        cleanup {
            // Clean up dangling Docker build cache on the Jenkins agent
            sh "docker system prune -f --filter 'until=24h' || true"
        }
    }
}
