// =====================================================
// طبقة بيانات الملاحظات — Online-First صارمة
// لا قاعدة ظل. لا سقوط صامت.
// =====================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { TABLES } from '../../types/db';
import type { Note, NoteInsert } from '../../types/db';

export const useNotes = () => {
  return useQuery({
    queryKey: ['notes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLES.notes)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw toAppError(error, 'حصلت مشكلة وإحنا بنحمّل الملاحظات.');
      return (data ?? []) as Note[];
    },
  });
};

export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (newNote: NoteInsert) => {
      const { data, error } = await supabase
        .from(TABLES.notes)
        .insert(newNote)
        .select()
        .single();
      if (error) throw toAppError(error, 'معرفناش نحفظ الملاحظة.');
      return data as Note;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from(TABLES.notes).delete().eq('id', id);
      if (error) throw toAppError(error, 'معرفناش نمسح الملاحظة.');
      return id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};
