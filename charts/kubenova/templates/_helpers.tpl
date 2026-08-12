{{/*
Expand the name of the chart.
*/}}
{{- define "kubenova.name" -}}
{{- .Chart.Name }}
{{- end }}

{{/*
Full image reference for a given component.
Usage: {{ include "kubenova.image" (dict "root" . "name" .Values.ui.image.name) }}
*/}}
{{- define "kubenova.image" -}}
{{- printf "%s/%s/%s:%s" .root.Values.image.registry .root.Values.image.org .name .root.Values.image.tag }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kubenova.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
