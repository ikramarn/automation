{{/*
Expand the name of the chart.
*/}}
{{- define "automation.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "automation.fullname" -}}
{{- printf "%s" .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "automation.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Build a full image reference: registry/repository:tag
*/}}
{{- define "automation.image" -}}
{{- $reg := .global.registry -}}
{{- $repo := .image.repository -}}
{{- $tag := default .global.imageTag (.image.tag) -}}
{{- printf "%s/%s:%s" $reg $repo $tag }}
{{- end }}
