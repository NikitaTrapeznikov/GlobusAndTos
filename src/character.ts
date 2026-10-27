/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * МОДУЛЬ 2: ОПИСАНИЕ ПЕРСОНАЖА, ОРУЖИЯ, НАВЫКОВ, ПОСТРОЕК И СОХРАНЕНИЯ (Character & Save System)
 * Отвечает за все характеристики героя, дерево навыков, прокачку оружия (Пистолет, Дробовик, Автомат, Гранатомет),
 * параметры укреплений/турелей и сериализацию прогресса в localStorage.
 */

export type WeaponId = 'pistol' | 'shotgun' | 'assault' | 'launcher';

export type BuildingType =
  | 'hq'
  | 'wall'
  | 'door'
  | 'spikes'
  | 'generator'
  | 'turret_mg'
  | 'turret_sniper'
  | 'turret_rocket';

export type SkillId =
  | 'vitality'
  | 'agility'
  | 'regeneration'
  | 'firepower'
  | 'rapid_fire'
  | 'explosive_mastery'
  | 'fortification'
  | 'turret_overclock'
  | 'generator_efficiency';

export interface WeaponConfig {
  id: WeaponId;
  name: string;
  hotkey: string;
  description: string;
  unlockedByDefault: boolean;
  unlockCostMetal: number;
  unlockCostEnergy: number;
  baseDamage: number;
  baseFireRate: number; // выстрелов в секунду
  bulletSpeed: number;
  pellets: number;
  spread: number; // радианы
  explosionRadius: number;
  color: string;
  upgradeCostBase: { metal: number; energy: number };
}

export interface WeaponState {
  unlocked: boolean;
  level: number; // 1..5
}

export interface SkillDefinition {
  id: SkillId;
  branch: 'survival' | 'combat' | 'engineering';
  branchLabel: string;
  name: string;
  description: string;
  maxLevel: number;
  effectPerLevelLabel: string;
}

export interface BuildingBlueprint {
  type: BuildingType;
  name: string;
  shortName: string;
  hotkey: string;
  description: string;
  costMetal: number;
  costEnergy: number;
  baseHp: number;
  passableByPlayer: boolean;
  passableByZombie: boolean;
  range?: number;
  fireRate?: number;
  damage?: number;
  explosionRadius?: number;
  genMetalPerCycle?: number;
  genEnergyPerCycle?: number;
}

export interface SavedBuilding {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  hp: number;
  maxHp: number;
  level: number; // 1..3
}

export interface CharacterProfile {
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  skillPoints: number;
  totalKills: number;
  highestWave: number;
  skills: Record<SkillId, number>;
  weapons: Record<WeaponId, WeaponState>;
  equippedWeapon: WeaponId;
}

export interface SavedRunState {
  wave: number;
  metal: number;
  energy: number;
  playerHp: number;
  buildings: SavedBuilding[];
  savedAt: number;
}

export interface FullSaveData {
  version: number;
  profile: CharacterProfile;
  activeRun: SavedRunState | null;
}

export const WEAPON_CONFIGS: Record<WeaponId, WeaponConfig> = {
  pistol: {
    id: 'pistol',
    name: 'Тактический пистолет',
    hotkey: '1',
    description: 'Надежное табельное оружие с высокой точностью и стабильным темпом стрельбы.',
    unlockedByDefault: true,
    unlockCostMetal: 0,
    unlockCostEnergy: 0,
    baseDamage: 26,
    baseFireRate: 4.0,
    bulletSpeed: 760,
    pellets: 1,
    spread: 0.04,
    explosionRadius: 0,
    color: '#FBBF24',
    upgradeCostBase: { metal: 65, energy: 30 },
  },
  shotgun: {
    id: 'shotgun',
    name: 'Боевой дробовик',
    hotkey: '2',
    description: 'Выпускает плотный веер картечи, сокрушая толпы зомби на ближней дистанции.',
    unlockedByDefault: false,
    unlockCostMetal: 115,
    unlockCostEnergy: 55,
    baseDamage: 20,
    baseFireRate: 1.45,
    bulletSpeed: 680,
    pellets: 7,
    spread: 0.34,
    explosionRadius: 0,
    color: '#F97316',
    upgradeCostBase: { metal: 95, energy: 50 },
  },
  assault: {
    id: 'assault',
    name: 'Штурмовой автомат',
    hotkey: '3',
    description: 'Скорострельная винтовка для подавления быстрых мутантов на средней и дальней дистанции.',
    unlockedByDefault: false,
    unlockCostMetal: 180,
    unlockCostEnergy: 90,
    baseDamage: 23,
    baseFireRate: 9.0,
    bulletSpeed: 840,
    pellets: 1,
    spread: 0.085,
    explosionRadius: 0,
    color: '#38BDF8',
    upgradeCostBase: { metal: 130, energy: 70 },
  },
  launcher: {
    id: 'launcher',
    name: 'Гранатомет «Вулкан»',
    hotkey: '4',
    description: 'Стреляет фугасными зарядами, уничтожающими целые группы врагов взрывной волной.',
    unlockedByDefault: false,
    unlockCostMetal: 280,
    unlockCostEnergy: 155,
    baseDamage: 135,
    baseFireRate: 0.9,
    bulletSpeed: 520,
    pellets: 1,
    spread: 0.03,
    explosionRadius: 96,
    color: '#EF4444',
    upgradeCostBase: { metal: 175, energy: 105 },
  },
};

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  // Выживание
  {
    id: 'vitality',
    branch: 'survival',
    branchLabel: 'Выживание',
    name: 'Титановая броня',
    description: 'Увеличивает максимальный запас здоровья персонажа.',
    maxLevel: 5,
    effectPerLevelLabel: '+25 макс. HP за уровень',
  },
  {
    id: 'agility',
    branch: 'survival',
    branchLabel: 'Выживание',
    name: 'Сервоприводы бега',
    description: 'Повышает скорость передвижения выжившего по карте.',
    maxLevel: 5,
    effectPerLevelLabel: '+8% к скорости бега',
  },
  {
    id: 'regeneration',
    branch: 'survival',
    branchLabel: 'Выживание',
    name: 'Нано-регенерация',
    description: 'Постепенно восстанавливает здоровье игрока каждую секунду.',
    maxLevel: 5,
    effectPerLevelLabel: '+1.5 HP/сек регенерации',
  },
  // Бой
  {
    id: 'firepower',
    branch: 'combat',
    branchLabel: 'Вооружение',
    name: 'Крупный калибр',
    description: 'Увеличивает урон всего ручного оружия игрока.',
    maxLevel: 5,
    effectPerLevelLabel: '+15% к урону оружия',
  },
  {
    id: 'rapid_fire',
    branch: 'combat',
    branchLabel: 'Вооружение',
    name: 'Ускоренный затвор',
    description: 'Повышает скорострельность пистолета, дробовика, автомата и гранатомета.',
    maxLevel: 5,
    effectPerLevelLabel: '+10% к темпу стрельбы',
  },
  {
    id: 'explosive_mastery',
    branch: 'combat',
    branchLabel: 'Вооружение',
    name: 'Фугасный резонанс',
    description: 'Расширяет радиус взрыва гранатомета и установок HIMARS.',
    maxLevel: 5,
    effectPerLevelLabel: '+12% к радиусу взрывов',
  },
  // Инженерия
  {
    id: 'fortification',
    branch: 'engineering',
    branchLabel: 'Инженерия базы',
    name: 'Армированный бетон',
    description: 'Повышает прочность Штаба, стен, дверей, шипов, генераторов и башен.',
    maxLevel: 5,
    effectPerLevelLabel: '+20% к прочности построек',
  },
  {
    id: 'turret_overclock',
    branch: 'engineering',
    branchLabel: 'Инженерия базы',
    name: 'Форсаж турелей',
    description: 'Увеличивает урон и скорострельность всех автоматических башен.',
    maxLevel: 5,
    effectPerLevelLabel: '+14% к мощи башен',
  },
  {
    id: 'generator_efficiency',
    branch: 'engineering',
    branchLabel: 'Инженерия базы',
    name: 'Квантовый синтез',
    description: 'Увеличивает выработку Металла и Энергии автоматическими генераторами.',
    maxLevel: 5,
    effectPerLevelLabel: '+20% к добыче генераторов',
  },
];

export const BUILDING_BLUEPRINTS: Record<BuildingType, BuildingBlueprint> = {
  hq: {
    type: 'hq',
    name: 'Главный Штаб-Генератор',
    shortName: 'Штаб',
    hotkey: '-',
    description: 'Энергетическое сердце базы. Если зомби разрушат его, оборона падет.',
    costMetal: 0,
    costEnergy: 0,
    baseHp: 1200,
    passableByPlayer: false,
    passableByZombie: false,
    genMetalPerCycle: 6,
    genEnergyPerCycle: 3,
  },
  wall: {
    type: 'wall',
    name: 'Армированная стена',
    shortName: 'Стена',
    hotkey: 'Z',
    description: 'Прочный барьер, сдерживающий натиск волн зомби.',
    costMetal: 24,
    costEnergy: 0,
    baseHp: 270,
    passableByPlayer: false,
    passableByZombie: false,
  },
  door: {
    type: 'door',
    name: 'Сенсорная бронедверь',
    shortName: 'Дверь',
    hotkey: 'E',
    description: 'Тактический шлюз: свободно пропускает игрока, но блокирует зомби.',
    costMetal: 34,
    costEnergy: 10,
    baseHp: 240,
    passableByPlayer: true,
    passableByZombie: false,
  },
  spikes: {
    type: 'spikes',
    name: 'Титановые шипы',
    shortName: 'Шипы',
    hotkey: 'X',
    description: 'Ловушка в полу: не мешает ходьбе, но замедляет и режет зомби.',
    costMetal: 30,
    costEnergy: 8,
    baseHp: 180,
    passableByPlayer: true,
    passableByZombie: true,
    damage: 20,
  },
  generator: {
    type: 'generator',
    name: 'Генератор ресурсов',
    shortName: 'Генератор',
    hotkey: 'V',
    description: 'Автоматически производит Металл и Энергию внутри базы.',
    costMetal: 65,
    costEnergy: 25,
    baseHp: 200,
    passableByPlayer: false,
    passableByZombie: false,
    genMetalPerCycle: 9,
    genEnergyPerCycle: 5,
  },
  turret_mg: {
    type: 'turret_mg',
    name: 'Пулеметная турель «Шквал»',
    shortName: 'Турель ПМ',
    hotkey: 'F',
    description: 'Скорострельная башня с плавным сервоприводом наведения.',
    costMetal: 75,
    costEnergy: 30,
    baseHp: 240,
    passableByPlayer: false,
    passableByZombie: false,
    range: 255,
    fireRate: 4.4,
    damage: 17,
  },
  turret_sniper: {
    type: 'turret_sniper',
    name: 'Катушка Тесла «Разряд»',
    shortName: 'Тесла',
    hotkey: 'G',
    description: 'Бьет высоковольтной цепной молнией сразу по нескольким зомби.',
    costMetal: 115,
    costEnergy: 65,
    baseHp: 230,
    passableByPlayer: false,
    passableByZombie: false,
    range: 240,
    fireRate: 0.9,
    damage: 58,
  },
  turret_rocket: {
    type: 'turret_rocket',
    name: 'РСЗО «HIMARS»',
    shortName: 'HIMARS',
    hotkey: 'H',
    description: 'Бронированная 6-трубная пусковая установка для залпового огня по площади.',
    costMetal: 165,
    costEnergy: 95,
    baseHp: 270,
    passableByPlayer: false,
    passableByZombie: false,
    range: 360,
    fireRate: 0.65,
    damage: 85,
    explosionRadius: 88,
  },
};

export const BUILDABLE_TYPES: BuildingType[] = [
  'wall',
  'door',
  'spikes',
  'generator',
  'turret_mg',
  'turret_sniper',
  'turret_rocket',
];

const SAVE_STORAGE_KEY = 'bastion_z_modular_save_v1';

export function createDefaultProfile(): CharacterProfile {
  return {
    name: 'Командир Бастиона',
    level: 1,
    xp: 0,
    xpToNext: 100,
    skillPoints: 1,
    totalKills: 0,
    highestWave: 1,
    skills: {
      vitality: 0,
      agility: 0,
      regeneration: 0,
      firepower: 0,
      rapid_fire: 0,
      explosive_mastery: 0,
      fortification: 0,
      turret_overclock: 0,
      generator_efficiency: 0,
    },
    weapons: {
      pistol: { unlocked: true, level: 1 },
      shotgun: { unlocked: false, level: 1 },
      assault: { unlocked: false, level: 1 },
      launcher: { unlocked: false, level: 1 },
    },
    equippedWeapon: 'pistol',
  };
}

/**
 * Вычисляет итоговые характеристики персонажа и базы с учетом прокачанных навыков и уровней оружия
 */
export function computeCharacterStats(profile: CharacterProfile) {
  const maxHp = 120 + profile.skills.vitality * 25;
  const moveSpeed = 215 * (1 + profile.skills.agility * 0.08);
  const hpRegen = 0.5 + profile.skills.regeneration * 1.5;

  const damageMultiplier = 1 + profile.skills.firepower * 0.15;
  const fireRateMultiplier = 1 + profile.skills.rapid_fire * 0.1;
  const explosionRadiusMultiplier = 1 + profile.skills.explosive_mastery * 0.12;

  const buildingHpMultiplier = 1 + profile.skills.fortification * 0.2;
  const turretPowerMultiplier = 1 + profile.skills.turret_overclock * 0.14;
  const generatorMultiplier = 1 + profile.skills.generator_efficiency * 0.2;

  return {
    maxHp,
    moveSpeed,
    hpRegen,
    damageMultiplier,
    fireRateMultiplier,
    explosionRadiusMultiplier,
    buildingHpMultiplier,
    turretPowerMultiplier,
    generatorMultiplier,
  };
}

export function getEffectiveWeaponStats(profile: CharacterProfile, weaponId: WeaponId) {
  const cfg = WEAPON_CONFIGS[weaponId];
  const state = profile.weapons[weaponId];
  const charStats = computeCharacterStats(profile);
  const lvlBonus = 1 + (state.level - 1) * 0.22;
  const rateLvlBonus = 1 + (state.level - 1) * 0.08;

  return {
    ...cfg,
    unlocked: state.unlocked,
    level: state.level,
    damage: Math.round(cfg.baseDamage * lvlBonus * charStats.damageMultiplier),
    fireRate: Number((cfg.baseFireRate * rateLvlBonus * charStats.fireRateMultiplier).toFixed(2)),
    explosionRadius: Math.round(cfg.explosionRadius * charStats.explosionRadiusMultiplier),
    upgradeMetalCost: Math.round(cfg.upgradeCostBase.metal * Math.pow(1.45, state.level - 1)),
    upgradeEnergyCost: Math.round(cfg.upgradeCostBase.energy * Math.pow(1.45, state.level - 1)),
  };
}

export function addExperience(profile: CharacterProfile, amount: number): {
  updated: CharacterProfile;
  leveledUp: boolean;
} {
  let xp = profile.xp + amount;
  let level = profile.level;
  let xpToNext = profile.xpToNext;
  let skillPoints = profile.skillPoints;
  let leveledUp = false;

  while (xp >= xpToNext) {
    xp -= xpToNext;
    level += 1;
    skillPoints += 1;
    xpToNext = Math.round(100 * Math.pow(1.28, level - 1));
    leveledUp = true;
  }

  return {
    updated: {
      ...profile,
      level,
      xp,
      xpToNext,
      skillPoints,
    },
    leveledUp,
  };
}

/**
 * Менеджер сохранения и загрузки прогресса в localStorage
 */
export const SaveManager = {
  load(): FullSaveData {
    try {
      const raw = localStorage.getItem(SAVE_STORAGE_KEY);
      if (!raw) {
        return {
          version: 1,
          profile: createDefaultProfile(),
          activeRun: null,
        };
      }
      const parsed = JSON.parse(raw) as FullSaveData;
      const defaultProf = createDefaultProfile();
      return {
        version: 1,
        profile: {
          ...defaultProf,
          ...parsed.profile,
          skills: { ...defaultProf.skills, ...(parsed.profile?.skills || {}) },
          weapons: { ...defaultProf.weapons, ...(parsed.profile?.weapons || {}) },
        },
        activeRun: parsed.activeRun || null,
      };
    } catch {
      return {
        version: 1,
        profile: createDefaultProfile(),
        activeRun: null,
      };
    }
  },

  save(profile: CharacterProfile, activeRun: SavedRunState | null): void {
    try {
      const payload: FullSaveData = {
        version: 1,
        profile,
        activeRun,
      };
      localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota issues
    }
  },

  clearActiveRun(profile: CharacterProfile): void {
    this.save(profile, null);
  },

  resetAll(): FullSaveData {
    const fresh: FullSaveData = {
      version: 1,
      profile: createDefaultProfile(),
      activeRun: null,
    };
    try {
      localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // Ignore
    }
    return fresh;
  },
};
