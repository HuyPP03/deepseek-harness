/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'

/** The complete editable internal-testing notice in all supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  en: {
    title: 'Internal Testing Notice',
    body: "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.",
    continueLabel: 'Continue',
  },
  vi: {
    title: 'Tuyên bố kiểm thử nội bộ',
    body: 'Phiên bản 0.1 hiện tại của DeepSeek Harness vẫn đang ở giai đoạn kiểm thử dành cho các nhà phát triển Harness, còn nhiều điểm cần cải thiện và hoàn thiện, và chúng tôi mong nhận được phản hồi từ cộng đồng nhà phát triển. Các plugin lõi và API nền tảng của DeepSeek Harness dự kiến sẽ tiếp tục lặp đổi nhanh và tiến hóa trong thời gian tới.\n\nChúng tôi mong muốn cùng các nhà phát triển trên toàn cầu, trên nền hạ tầng mã nguồn mở, mở, có thể tái sử dụng và có thể tổ hợp, cùng khám phá giới hạn của trí thông minh. Chào đón các nhà phát triển Harness trên toàn cầu tham gia hệ sinh thái plugin DSH.',
    continueLabel: 'Tiếp tục',
  },
  zh: {
    title: '内测声明',
    body: 'DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\n\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。',
    continueLabel: '继续',
  },
} as const
