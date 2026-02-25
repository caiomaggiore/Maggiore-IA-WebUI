# TODO: implementar integração com n8n via webhooks (endpoints /integrations/n8n/*).
# TODO: helpers para montar payloads e responder webhooks quando a automação for usada.

"""Helpers para integração com n8n via webhooks. Pendente de implementação."""


def build_webhook_payload(event: str, data: dict) -> dict:
    """Stub: monta o payload para um webhook do n8n."""
    # TODO: implementar quando houver fluxos n8n definidos.
    return {"event": event, "data": data}
