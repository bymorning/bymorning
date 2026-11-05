{{- define "bymorning.name" -}}bymorning{{- end -}}

{{- define "bymorning.fullname" -}}
{{- if .Release.Name | hasPrefix "bymorning" -}}{{ .Release.Name | trunc 50 | trimSuffix "-" }}{{- else -}}{{ printf "%s-bymorning" .Release.Name | trunc 50 | trimSuffix "-" }}{{- end -}}
{{- end -}}

{{- define "bymorning.labels" -}}
app.kubernetes.io/name: {{ include "bymorning.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}

{{- define "bymorning.selector" -}}
app.kubernetes.io/name: {{ include "bymorning.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "bymorning.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}{{ default (include "bymorning.fullname" .) .Values.serviceAccount.name }}{{- else -}}{{ default "default" .Values.serviceAccount.name }}{{- end -}}
{{- end -}}

{{/* The image, pinned by digest. Fails the render without one. */}}
{{- define "bymorning.image" -}}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" (.Values.image.digest | default "")) -}}
{{- fail "image.digest is required and must be sha256:<64 hex>. Pin the image by digest; look it up with `crane digest ghcr.io/bymorning/bymorning:<version>` and verify it with cosign first." -}}
{{- end -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- end -}}

{{/* The Secret the pod reads: yours, or the one this chart creates. */}}
{{- define "bymorning.secretName" -}}
{{- if .Values.existingSecret -}}{{ .Values.existingSecret }}{{- else -}}{{ include "bymorning.fullname" . }}{{- end -}}
{{- end -}}

{{/* Fail early on the settings every installation needs. */}}
{{- define "bymorning.validate" -}}
{{- if not .Values.appOrigin -}}{{- fail "appOrigin is required: the public origin people open, for example https://bymorning.example.com" -}}{{- end -}}
{{- if and (not .Values.existingSecret) (not .Values.secrets) -}}{{- fail "provide secrets: set existingSecret to a Secret with DATABASE_URL and WEB_COOKIE_KEY, or (for a trial) secrets.DATABASE_URL and secrets.WEB_COOKIE_KEY" -}}{{- end -}}
{{- if and .Values.evaluation.enabled (not (hasPrefix "http://localhost" .Values.appOrigin)) (not (hasPrefix "http://127.0.0.1" .Values.appOrigin)) (not (hasPrefix "https://" .Values.appOrigin)) -}}{{- fail "appOrigin must be https, or http://localhost for an evaluation installation" -}}{{- end -}}
{{- if and (not .Values.evaluation.enabled) (not (hasPrefix "https://" .Values.appOrigin)) -}}{{- fail "appOrigin must be an https origin; only an evaluation installation may use http://localhost" -}}{{- end -}}
{{- if and (not .Values.evaluation.enabled) (not .Values.config.STORAGE_PROVIDER) -}}{{- fail "config.STORAGE_PROVIDER and config.CIPHER_BACKEND are required (s3 with kms, or azure-blob with keyvault); see the values file" -}}{{- end -}}
{{- if and .Values.tls.enabled (not .Values.tls.secretName) -}}{{- fail "tls.secretName is required when tls.enabled" -}}{{- end -}}
{{- end -}}

{{/* Environment shared by the migrate and gateway containers. */}}
{{- define "bymorning.envFrom" -}}
- configMapRef:
    name: {{ include "bymorning.fullname" . }}
- secretRef:
    name: {{ include "bymorning.secretName" . }}
{{- end -}}
