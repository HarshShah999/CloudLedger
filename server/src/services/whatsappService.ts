import { decryptSecret } from '../utils/secrets';
import { whatsappNumber } from './documentService';

const GRAPH = process.env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0';

export interface WhatsAppConfig {
    whatsapp_phone_number_id: string | null;
    whatsapp_token_enc: string | null;
    whatsapp_template: string | null;
    whatsapp_template_lang: string | null;
}

export const whatsappConfigured = (c: WhatsAppConfig) =>
    !!(c.whatsapp_phone_number_id && c.whatsapp_token_enc && c.whatsapp_template);

/**
 * Sends an approved template message through the WhatsApp Business Cloud API (Meta).
 * Business-initiated messages must use a template approved in WhatsApp Manager;
 * `params` fill its body variables {{1}}, {{2}}… in order.
 */
export const sendWhatsAppTemplate = async (c: WhatsAppConfig, phone: string, params: string[]) => {
    const token = decryptSecret(c.whatsapp_token_enc);
    if (!whatsappConfigured(c) || !token) throw new Error('WhatsApp is not set up for this company');
    const to = whatsappNumber(phone);
    if (!to) throw new Error(`Not a valid mobile number: ${phone}`);

    const res = await fetch(`${GRAPH}/${c.whatsapp_phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: c.whatsapp_template,
                language: { code: c.whatsapp_template_lang || 'en' },
                components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
            },
        }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `WhatsApp API error ${res.status}`);
    return body?.messages?.[0]?.id as string | undefined;
};
