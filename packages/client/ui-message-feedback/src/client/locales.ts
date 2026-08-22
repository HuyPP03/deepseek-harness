/** `feedback` namespace dictionaries. */

/** English dictionary (the key-set source of truth). */
export const en = {
  'action.like': 'Good response',
  'action.likeActive': 'Remove rating',
  'action.dislike': 'Bad response',
  'action.dislikeActive': 'Remove rating',
  'note.open': 'Add a note',
  'note.placeholder': 'What was good, or what went wrong? (optional)',
  'note.save': 'Save',
  'note.cancel': 'Cancel',
  'note.aria': 'Feedback note',
  'error.conflict': 'This feedback changed elsewhere; the latest state is shown',
  'error.load': 'Could not load feedback',
  'error.generic': 'Could not save feedback',
} satisfies Record<string, string>

/** The feedback namespace key union. */
export type MessageFeedbackKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The per-message feedback controls' copy. */
    feedback: MessageFeedbackKey
  }
}

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'action.like': 'Câu trả lời tốt',
  'action.likeActive': 'Gỡ đánh giá',
  'action.dislike': 'Câu trả lời kém',
  'action.dislikeActive': 'Gỡ đánh giá',
  'note.open': 'Thêm ghi chú',
  'note.placeholder': 'Điều gì tốt, hoặc điều gì không đúng? (không bắt buộc)',
  'note.save': 'Lưu',
  'note.cancel': 'Hủy',
  'note.aria': 'Ghi chú phản hồi',
  'error.conflict': 'Phản hồi này đã thay đổi ở nơi khác; đang hiển thị trạng thái mới nhất',
  'error.load': 'Không tải được phản hồi',
  'error.generic': 'Không lưu được phản hồi',
} satisfies Record<MessageFeedbackKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'action.like': '好的回答',
  'action.likeActive': '取消标记',
  'action.dislike': '有问题的回答',
  'action.dislikeActive': '取消标记',
  'note.open': '补充说明',
  'note.placeholder': '这条回答哪里好，或哪里有问题？（可选）',
  'note.save': '保存',
  'note.cancel': '取消',
  'note.aria': '反馈说明',
  'error.conflict': '这条反馈已在别处改动，已显示最新状态',
  'error.load': '反馈状态加载失败',
  'error.generic': '反馈保存失败',
} satisfies Record<MessageFeedbackKey, string>
