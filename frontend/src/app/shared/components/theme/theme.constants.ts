import { BgType, SectionIcon } from '../../models/ui-config.model';

export const SECTION_OPTIONS: SectionIcon[] = [
  {
    svgIcon: 'dots_2',
    fontIcon: null,
    color: 'text-white!',
    label: 'Dotted',
    value: BgType.DOTTED,
  },
  {
    svgIcon: null,
    fontIcon: 'texture',
    color: '',
    label: 'Striped',
    value: BgType.STRIPED,
  },
  {
    svgIcon: 'glass',
    fontIcon: null,
    color: '',
    label: 'Glass',
    value: BgType.GLASS,
  },
  {
    svgIcon: 'gradient',
    fontIcon: null,
    color: 'text-(--rt-accent)!',
    label: 'Gradient',
    value: BgType.GRADIENT,
  },
  {
    svgIcon: null,
    fontIcon: 'local_fire_department',
    color: 'text-orange-500!',
    label: 'Fire',
    value: BgType.FIRE,
  },
  {
    svgIcon: null,
    fontIcon: 'star',
    color: 'text-yellow-500! animate-pulse',
    label: 'Stars',
    value: BgType.STARS,
  },
  {
    svgIcon: null,
    fontIcon: 'ac_unit',
    color: 'text-blue-200! animate-spin',
    label: 'Snow',
    value: BgType.SNOW,
  },
  {
    svgIcon: null,
    fontIcon: 'water_drop',
    color: 'text-blue-500! animate-bounce',
    label: 'Rain',
    value: BgType.RAIN,
  },
  {
    svgIcon: 'neo',
    fontIcon: null,
    color: '',
    label: 'The Matrix',
    value: BgType.MATRIX,
  },
  {
    svgIcon: null,
    fontIcon: null,
    color: '',
    label: 'None',
    value: BgType.NONE,
  },
];
