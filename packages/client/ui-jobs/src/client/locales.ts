/** `job` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'job'

/** English dictionary (the key-set source of truth). */
export const en = {
  'count.live.one': '{count} background job running',
  'count.live.other': '{count} background jobs running',
  'count.idle.one': '{count} background job',
  'count.idle.other': '{count} background jobs',
  'list.aria': 'Background jobs',
  'status.running': 'running',
  'status.stopping': 'stopping',
  'status.completed': 'completed',
  'status.killed': 'cancelled',
  'status.failed': 'failed',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours}h {minutes}m',
  'duration.title.live': 'Running for {duration}',
  'duration.title.done': 'Took {duration}',
} satisfies Record<string, string>

/** The `job` namespace key union. */
export type JobKey = keyof typeof en

/** Vietnamese dictionary, checked complete against the en key set. */
export const vi = {
  'count.live.one': '{count} tác vụ nền đang chạy',
  'count.live.other': '{count} tác vụ nền đang chạy',
  'count.idle.one': '{count} tác vụ nền',
  'count.idle.other': '{count} tác vụ nền',
  'list.aria': 'Tác vụ nền',
  'status.running': 'đang chạy',
  'status.stopping': 'đang dừng',
  'status.completed': 'hoàn thành',
  'status.killed': 'đã hủy',
  'status.failed': 'thất bại',
  'duration.seconds': '{seconds} giây',
  'duration.minutes': '{minutes} phút {seconds} giây',
  'duration.hours': '{hours} giờ {minutes} phút',
  'duration.title.live': 'Đã chạy {duration}',
  'duration.title.done': 'Mất {duration}',
} satisfies Record<JobKey, string>

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh = {
  'count.live.one': '{count} 个后台任务运行中',
  'count.live.other': '{count} 个后台任务运行中',
  'count.idle.one': '{count} 个后台任务',
  'count.idle.other': '{count} 个后台任务',
  'list.aria': '后台任务',
  'status.running': '运行中',
  'status.stopping': '正在停止',
  'status.completed': '已完成',
  'status.killed': '已取消',
  'status.failed': '已失败',
  'duration.seconds': '{seconds}秒',
  'duration.minutes': '{minutes}分{seconds}秒',
  'duration.hours': '{hours}小时{minutes}分',
  'duration.title.live': '已运行 {duration}',
  'duration.title.done': '耗时 {duration}',
} satisfies Record<JobKey, string>
