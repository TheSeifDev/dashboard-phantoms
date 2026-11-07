// =====================================================
// Wasla AI — استدعاء حقيقي للـ Edge Function أوضح فشله.
// حُذف "المحلل المحلي" الذي كان يؤلف ردوداً كأنها من الـ AI
// عند فشل الاتصال (خادم غير متصل، انقطاع شبكة، إلخ) —
// التظاهر بالذكاء خطأ تشغيلي: المدير يظن أن الإجابة حقيقية ويتخذ
// قراراً بناءً على رد مُركَّب من مطابقة كلمات مفتاحية.
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

export const useAskWaslaAi = () => {
  return useMutation({
    mutationFn: async ({ question, context, history }: AskAiInput): Promise<AskAiResult> => {
      let data: AskAiResult | null = null;
      let invokeError: Error | null = null;

      try {
        const res = await supabase.functions.invoke<AskAiResult>('wasla-ai', {
          body: { question, context, history },
        });
        invokeError = res.error ?? null;
        data = res.data ?? null;
      } catch (err) {
        invokeError = err instanceof Error ? err : new Error(String(err));
      }

      // الدالة قد تعيد 200 مع جسم { error } — عاملها كخطأ
      if (invokeError) {
        throw new Error(
          'معرفناش نوصل لمساعد وصلة الذكي. اتأكد إن الإنترنت شغال وإن الـ Edge Function شغالة، وجرّب تاني.'
        );
      }
      if (!data || data.error) {
        throw new Error(data?.error || 'رد المساعد الذكي مش مفهوم.');
      }
      return data;
    },
  });
};
