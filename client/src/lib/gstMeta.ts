import { useEffect, useState } from 'react';
import api from '../api/axios';

export interface GstMeta {
    states: { code: string; name: string }[];
    tdsSections: { code: string; label: string; rate: number }[];
}

let cache: GstMeta | null = null;

/** States (with GST codes) and TDS sections, fetched once. */
export const useGstMeta = (): GstMeta => {
    const [meta, setMeta] = useState<GstMeta>(cache ?? { states: [], tdsSections: [] });
    useEffect(() => {
        if (cache) return;
        api.get('/gst/meta').then((r) => {
            cache = r.data.data;
            setMeta(r.data.data);
        });
    }, []);
    return meta;
};

/** State name for the first two digits of a GSTIN. */
export const stateFromGstin = (gstin: string, states: GstMeta['states']) =>
    /^\d{2}/.test(gstin) ? states.find((s) => s.code === gstin.slice(0, 2))?.name ?? '' : '';
