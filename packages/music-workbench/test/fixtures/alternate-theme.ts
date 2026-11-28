import { descriptor } from '@any-music/theme-default'
import { definition } from '@any-music/theme-default/vue'

export const alternateDescriptor = { ...descriptor, id: 'alternate', title: '测试主题' }
export const alternateDefinition = { ...definition, id: alternateDescriptor.id }
