// =====================================================
// PHANTOMS AI — استدعاء حقيقي للـ Edge Function
// =====================================================
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';

export interface AiAction {
  type: string;
  payload?: Record<string, unknown>;
  name?: string;
  title?: string;
  patch?: Record<string, unknown>;
  description?: string;
  id?: number | string;
}

/** دور محادثة واحد موجه لدى الـ Edge Function */
export interface AiChatTurn {
  role: 'user' | 'assistant';
  parts: { text: string }[];
}

export interface AiMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  action?: AiAction | null;
  actionExecuted?: boolean;
}

export interface AskAiInput {
  question: string;
  context: string;
  history?: AiChatTurn[];
}

export interface AskAiResult {
  answer: string;
  action?: AiAction | null;
  error?: string;
}

const PRIMARY_FUNCTION_SLUG = import.meta.env.VITE_PHANTOMS_AI_FUNCTION || 'phantoms-ai';
const FALLBACK_FUNCTION_SLUG = import.meta.env.VITE_WASLA_AI_FUNCTION || 'wasla-ai';

export const useAskPhantomsAi = () => {
  return useMutation({
    mutationFn: async ({ question, context, history }: AskAiInput): Promise<AskAiResult> => {
      let data: AskAiResult | null = null;
      let invokeError: Error | null = null;

      // Try official PHANTOMS function slug first, with resilient fallback to historical slug
      try {
        const res = await supabase.functions.invoke<AskAiResult>(PRIMARY_FUNCTION_SLUG, {
          body: { question, context, history },
        });
        if (res.error && (res.error.message?.includes('404') || res.error.message?.includes('Not Found'))) {
          // Attempt legacy slug for unmigrated staging/prod
          const fallbackRes = await supabase.functions.invoke<AskAiResult>(FALLBACK_FUNCTION_SLUG, {
            body: { question, context, history },
          });
          invokeError = fallbackRes.error ?? null;
          data = fallbackRes.data ?? null;
        } else {
          invokeError = res.error ?? null;
          data = res.data ?? null;
        }
      } catch (err) {
        invokeError = err instanceof Error ? err : new Error(String(err));
      }

      // الدالة قد تعيد 200 مع جسم { error } — عاملها كخطأ
      if (invokeError) {
        throw new Error(
          'معرفناش نوصل لمساعد PHANTOMS الذكي. اتأكد إن الإنترنت شغال وإن الـ Edge Function شغالة، وجرّب تاني.'
        );
      }
      if (!data || data.error) {
        throw new Error(data?.error || 'رد المساعد الذكي مش مفهوم.');
      }
      return data;
    },
  });
};

/** Backward compatibility alias */
export const useAskWaslaAi = useAskPhantomsAi;
