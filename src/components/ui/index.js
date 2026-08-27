// src/components/ui/index.js
// Centralized barrel export for all UI components
// This is the single source of truth for all component imports across the application
//
// Every name here is rendered by the product and previewed in /ui-kit. There is
// no third state: 31 components used to sit in this file exported and unused,
// which meant the barrel described an inventory nobody could see on a screen
// and half of it duplicated something already live (Avatar beside UserAvatar,
// Badge beside Pill, Chip beside Tag, Stat beside KpiCard). `npm run test:unit`
// now fails if an unused component reappears.

// ===== CORE LAYOUT COMPONENTS =====
export { default as Surface } from './Surface'
export { default as ImageUpload } from './ImageUpload'
export { default as ChatComposerCore } from './ChatComposerCore'
export { default as IconAction } from './IconAction'

// ===== FORM COMPONENTS =====
export { Input } from './Input'
export { Textarea } from './Forms/Textarea'
export { default as Checkbox } from './Forms/Checkbox'
export { default as ToggleSwitch } from './Forms/ToggleSwitch'
export { Select } from './Select'
export { DatePicker } from './Forms/DatePicker'
export { TimePicker } from './Forms/TimePicker'
export { default as Label } from './Forms/Label'
export { default as FormGroup } from './Forms/FormGroup'
export { default as MarkdownEditor } from './Forms/MarkdownEditor'
export { default as SelectableChip } from './Forms/SelectableChip'
export { default as OptionCard } from './Forms/OptionCard'
export { default as ResponseChoice } from './Forms/ResponseChoice'
export { default as ColorSwatch } from './Forms/ColorSwatch'
export { default as ListRow } from './Layout/ListRow'
export { default as MediaPlayButton } from './MediaPlayButton'

// ===== ATTACHMENTS =====
// What a file is, and what you can do with it without leaving the page. Both
// are answered once and used by the task surface, the chat and the viewer, so a
// spreadsheet looks like a spreadsheet and a voice note plays wherever it lands.
export { default as FileThumb } from './Attachments/FileThumb'
export { default as AudioPlayer } from './Attachments/AudioPlayer'

// ===== CALENDAR =====
// The calendar is a structure with its own vocabulary, like chat: a day cell,
// the date in its corner, and the hour strip you click to create at a time.
export { default as CalendarEntry } from './Calendar/CalendarEntry'
export { default as CalendarDayNumber } from './Calendar/CalendarDayNumber'
export { default as CalendarDayCell } from './Calendar/CalendarDayCell'
export { default as CalendarHourSlot } from './Calendar/CalendarHourSlot'
export { default as TitleInput } from './Forms/TitleInput'

// ===== BUTTON COMPONENTS =====
export { default as Button } from './Button'
export { default as IconButton } from './Button'

// ===== DATA DISPLAY COMPONENTS =====
export { default as Tag } from './DataDisplay/Tag'
export { default as UserAvatar } from './DataDisplay/UserAvatar'
export { default as StatusPill } from './DataDisplay/StatusPill'
export { default as PlanMark } from './DataDisplay/PlanMark'
export { default as PlanCards } from './DataDisplay/PlanCards'
export { default as PriorityBadge } from './DataDisplay/PriorityBadge'
export { default as PriorityIcon } from './DataDisplay/PriorityIcon'
export { default as PresenceDot } from './DataDisplay/PresenceDot'
export { default as TypeBadge } from './DataDisplay/TypeBadge'
export { default as Pill } from './DataDisplay/Pill'
export { default as Counter } from './DataDisplay/Counter'
export { default as KpiCard } from './DataDisplay/KpiCard'
export { default as RefreshStamp } from './DataDisplay/RefreshStamp'
export { default as DataTable } from './DataDisplay/DataTable'

// ===== CHARTS =====
// The analytics vocabulary, in one place. Before this, "how much of each" was
// written five times across four files and no two agreed on the bar height, the
// track colour or what a full bar meant.
export { default as BarList } from './Charts/BarList'
export { default as ColumnChart } from './Charts/ColumnChart'
export { default as Meter } from './Charts/Meter'
export { default as Sparkline } from './Charts/Sparkline'
export { default as MarkdownViewer, setTaskChecked } from './DataDisplay/MarkdownViewer'
export { default as TaskCounters } from './TaskManagement/TaskCounters'
export { default as TaskIdentity } from './TaskManagement/TaskIdentity'
export { default as TaskListCard } from './TaskManagement/TaskListCard'
export { default as TaskListView } from './TaskManagement/TaskListView'
export { default as TaskTableView } from './TaskManagement/TaskTableView'
export { default as AttachmentRow } from './TaskManagement/AttachmentRow'
export { default as TimeLogRow } from './TaskManagement/TimeLogRow'
export { default as TimeTrackingControl } from './TaskManagement/TimeTrackingControl'
export { default as IssueLinkRow } from './TaskManagement/IssueLinkRow'
export { default as DescriptionPlaceholder } from './TaskManagement/DescriptionPlaceholder'
export { default as BulkActionBar } from './TaskManagement/BulkActionBar'
export { default as MetaTrigger } from './DataDisplay/MetaTrigger'
export { default as ProjectSettingsForm } from './TaskManagement/ProjectSettingsForm'
export { default as StatusVisibilityPicker } from './TaskManagement/StatusVisibilityPicker'
export { default as StatusTransitionPicker } from './TaskManagement/StatusTransitionPicker'

// ===== NAVIGATION COMPONENTS =====
export { Popover } from './Navigation/Popover'
export { Tooltip } from './Navigation/Tooltip'
export { default as InnerNavigation } from './Navigation/InnerNavigation'
export { default as MobilePaneBack } from './Navigation/MobilePaneBack'

// ===== FEEDBACK COMPONENTS =====
export { default as Alert } from './Feedback/Alert'
export { default as LoadingSpinner } from './Feedback/LoadingSpinner'
export { default as Skeleton } from './Feedback/Skeleton'
export { default as EmptyState } from './Feedback/EmptyState'
export { default as SignalList } from './Feedback/SignalList'
export { default as PlanGate } from './Feedback/PlanGate'
export { default as PlanDowngradeDialog } from './Feedback/PlanDowngradeDialog'
export { default as PlanLimitRail } from './Feedback/PlanLimitRail'
export { default as PlanUpgradeDialog } from './Feedback/PlanUpgradeDialog'

// ===== LAYOUT COMPONENTS =====
export { default as Card } from './Layout/Card'
export { default as TaskAttributesPanel, getTaskAttributeChrome, AttributeTrigger } from './Layout/TaskAttributesPanel'
export { default as SidebarLayout } from './Layout/SidebarLayout'
export { default as DetailLayout } from './Layout/DetailLayout'
export { default as DetailSection } from './Layout/DetailSection'
export { default as ChartCard } from './Layout/ChartCard'
export { default as PageHeader } from './Layout/PageHeader'
export { default as UserMenu } from './Layout/UserMenu'
export { default as NotificationBell } from './Layout/NotificationBell'
export { default as NotificationCard } from './Layout/NotificationCard'

// ===== EXISTING COMPONENTS =====
export { default as Dialog } from './Dialog'
export { default as AttachmentViewer } from './AttachmentViewer'
export { ConfirmProvider, useConfirm } from './ConfirmProvider'
export { default as Tabs } from './Tabs'
export { default as ContextMenu } from './ContextMenu'
export { default as ExportMenu } from './ExportMenu'
export { default as FilterBar } from './FilterBar'
export { default as Segmented } from './Segmented'
export { default as ChannelRail } from './Navigation/ChannelRail'
export { default as MemberRail } from './Navigation/MemberRail'
export { default as CommandPalette } from './Navigation/CommandPalette'
export { default as ConnectionBanner } from './Feedback/ConnectionBanner'
export { default as KeyboardShortcutsDialog } from './Navigation/KeyboardShortcutsDialog'

// ===== CHAT =====
// Chat is a structure, not a screen: the message row, the list around it, the
// header above it and the info panel beside it are all components the catalogue
// renders, so /ui-kit shows a conversation instead of a grey box where one goes.
export { default as MessageBubble } from './Chat/MessageBubble'
export { default as ChatMessageList } from './Chat/ChatMessageList'
export { default as UnreadDivider } from './Chat/UnreadDivider'
export { default as LoadOlderButton } from './Chat/LoadOlderButton'
export { default as ChatConversationHeader } from './Chat/ChatConversationHeader'
export { default as ChatSearchBanner } from './Chat/ChatSearchBanner'
export { default as ChannelInfoPanel } from './Chat/ChannelInfoPanel'
export { default as MentionMenu } from './Chat/MentionMenu'
export { default as IssueMentionMenu } from './Chat/IssueMentionMenu'
export { ChatAttachmentList, PendingChatAttachments } from './Chat/ChatAttachmentList'
export { default as TextAction } from './TextAction'
export { default as AvatarButton } from './DataDisplay/AvatarButton'
export { default as FileInput } from './Forms/FileInput'
