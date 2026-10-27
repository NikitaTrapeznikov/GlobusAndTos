/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * МОДУЛЬ 1 (MAIN): ИГРОВОЙ ЦИКЛ, СМЕНА ДНЯ И НОЧИ, ВОЛНЫ ЗОМБИ, СТРОИТЕЛЬСТВО БАЗЫ И ИНТЕРФЕЙС
 * Объединяет модуль Персонажа/Сохранений (character.ts) и модуль Отрисовки Спрайтов (sprites.ts).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  BuildingType,
  BUILDING_BLUEPRINTS,
  BUILDABLE_TYPES,
  CharacterProfile,
  SKILL_DEFINITIONS,
  SkillId,
  WeaponId,
  WEAPON_CONFIGS,
  SaveManager,
  SavedBuilding,
  addExperience,
  computeCharacterStats,
  getEffectiveWeaponStats,
} from './character';
import {
  RenderBuilding,
  RenderFloatingText,
  RenderParticle,
  RenderProjectile,
  RenderZombie,
  SpriteRenderer,
  ZombieVariant,
} from './sprites';
import { sound } from './sound';
import {
  Shield,
  Zap,
  Wrench,
  Crosshair,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  RotateCcw,
  Save,
  ArrowUpCircle,
  Hammer,
  Skull,
  Play,
  Award,
  Heart,
  Keyboard,
} from 'lucide-react';

type GameScreenState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER';

const GAME_VERSION = '1.1';
const WORLD_WIDTH = 2160;
const WORLD_HEIGHT = 1680;
const GRID_SIZE = 48;
const DAY_DURATION = 38; // секунд на подготовку и строительство днем (можно начать ночь досрочно)

interface ActiveProjectile extends RenderProjectile {
  damage: number;
  explosionRadius: number;
  life: number;
}

export default function App() {
  // Начальная загрузка сохранения из модуля Character & Save
  const initialSave = useRef(SaveManager.load());

  const [screenState, setScreenState] = useState<GameScreenState>('TITLE_MENU');
  const [profile, setProfile] = useState<CharacterProfile>(initialSave.current.profile);
  const [hasSavedRun, setHasSavedRun] = useState<boolean>(Boolean(initialSave.current.activeRun));

  // UI состояния для HUD (обновляются без перезапуска Canvas-цикла)
  const [hudState, setHudState] = useState({
    wave: 1,
    isNight: false,
    dayTimer: DAY_DURATION,
    zombiesRemaining: 0,
    metal: 150,
    energy: 60,
    playerHp: 120,
    playerMaxHp: 120,
    hqHp: 1200,
    hqMaxHp: 1200,
    buildMode: false,
    selectedBuildType: 'wall' as BuildingType,
    equippedWeapon: initialSave.current.profile.equippedWeapon,
    hoveredBuildingInfo: null as {
      id: string;
      type: BuildingType;
      level: number;
      hp: number;
      maxHp: number;
      upgradeMetal: number;
      upgradeEnergy: number;
      repairMetal: number;
      screenX: number;
      screenY: number;
    } | null,
  });

  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showControlsModal, setShowControlsModal] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'skills' | 'weapons'>('skills');
  const [isMuted, setIsMuted] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const profileRef = useRef<CharacterProfile>(profile);
  profileRef.current = profile;

  const screenStateRef = useRef<GameScreenState>(screenState);
  screenStateRef.current = screenState;

  const showSkillsModalRef = useRef<boolean>(showSkillsModal);
  showSkillsModalRef.current = showSkillsModal;

  const showControlsModalRef = useRef<boolean>(showControlsModal);
  showControlsModalRef.current = showControlsModal;

  // Полное мутабельное состояние симуляции для 60 FPS без ре-рендеров React
  const simRef = useRef({
    time: 0,
    wave: 1,
    isNight: false,
    dayTimer: DAY_DURATION,
    nightFactor: 0,
    metal: 150,
    energy: 60,
    genAccumTimer: 0,
    regenAccumTimer: 0,
    shakeTime: 0,
    shakeMagnitude: 0,
    hitstopTimer: 0,

    player: {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2 + 110,
      angle: 0,
      hp: 120,
      maxHp: 120,
      weapon: initialSave.current.profile.equippedWeapon,
      walkCycle: 0,
      muzzleFlash: 0,
      hitFlash: 0,
      fireCooldown: 0,
    },

    buildings: [] as RenderBuilding[],
    zombies: [] as (RenderZombie & {
      speed: number;
      damage: number;
      attackCooldown: number;
      spikeTick: number;
      rewardMetal: number;
      rewardEnergy: number;
      rewardXp: number;
    })[],
    projectiles: [] as ActiveProjectile[],
    particles: [] as RenderParticle[],
    floatingTexts: [] as RenderFloatingText[],

    spawnQueue: [] as ZombieVariant[],
    spawnTimer: 0,

    buildMode: false,
    selectedBuildType: 'wall' as BuildingType,
    hoverHoldId: null as string | null,
    hoverHoldTime: 0,

    input: {
      keys: new Set<string>(),
      mouseDown: false,
      rightMouseDown: false,
      mouseX: 0,
      mouseY: 0,
      worldMouseX: WORLD_WIDTH / 2,
      worldMouseY: WORLD_HEIGHT / 2,
    },
  });

  const triggerSaveToast = useCallback((msg: string) => {
    setSaveToast(msg);
    window.setTimeout(() => {
      setSaveToast((prev) => (prev === msg ? null : prev));
    }, 2200);
  }, []);

  /**
   * Сохраняет текущий прогресс персонажа и состояние базы
   */
  const saveCurrentGame = useCallback(
    (customProfile?: CharacterProfile, notify = false) => {
      const sim = simRef.current;
      const prof = customProfile || profileRef.current;
      const hq = sim.buildings.find((b) => b.type === 'hq');
      if (hq && hq.hp > 0 && sim.player.hp > 0) {
        const savedBuildings: SavedBuilding[] = sim.buildings.map((b) => ({
          id: b.id,
          type: b.type,
          gx: b.gx,
          gy: b.gy,
          hp: Math.round(b.hp),
          maxHp: Math.round(b.maxHp),
          level: b.level,
        }));
        SaveManager.save(prof, {
          wave: sim.wave,
          metal: Math.round(sim.metal),
          energy: Math.round(sim.energy),
          playerHp: Math.round(sim.player.hp),
          buildings: savedBuildings,
          savedAt: Date.now(),
        });
        setHasSavedRun(true);
      } else {
        SaveManager.save(prof, null);
      }
      if (notify) {
        triggerSaveToast('Прогресс персонажа и базы сохранен');
      }
    },
    [triggerSaveToast]
  );

  /**
   * Инициализация новой игры или восстановление сохраненной базы
   */
  const initGameSession = useCallback((resumeSaved: boolean) => {
    const savedData = SaveManager.load();
    const prof = savedData.profile;
    const charStats = computeCharacterStats(prof);
    const sim = simRef.current;

    const centerGx = Math.floor(WORLD_WIDTH / 2 / GRID_SIZE);
    const centerGy = Math.floor(WORLD_HEIGHT / 2 / GRID_SIZE);

    sim.time = 0;
    sim.isNight = false;
    sim.dayTimer = DAY_DURATION;
    sim.nightFactor = 0;
    sim.zombies = [];
    sim.projectiles = [];
    sim.particles = [];
    sim.floatingTexts = [];
    sim.spawnQueue = [];
    sim.buildMode = false;

    if (resumeSaved && savedData.activeRun && savedData.activeRun.buildings.length > 0) {
      const run = savedData.activeRun;
      sim.wave = run.wave;
      sim.metal = run.metal;
      sim.energy = run.energy;
      sim.player.hp = Math.min(charStats.maxHp, Math.max(35, run.playerHp));
      sim.player.maxHp = charStats.maxHp;
      sim.player.x = centerGx * GRID_SIZE + GRID_SIZE / 2;
      sim.player.y = (centerGy + 2) * GRID_SIZE + GRID_SIZE / 2;
      sim.player.weapon = prof.equippedWeapon;

      sim.buildings = run.buildings.map((sb) => ({
        ...sb,
        x: sb.gx * GRID_SIZE + GRID_SIZE / 2,
        y: sb.gy * GRID_SIZE + GRID_SIZE / 2,
        turretAngle: 0,
        recoil: 0,
        pulsePhase: Math.random() * Math.PI * 2,
      }));
    } else {
      sim.wave = 1;
      sim.metal = 105;
      sim.energy = 35;
      sim.player.maxHp = charStats.maxHp;
      sim.player.hp = charStats.maxHp;
      sim.player.x = centerGx * GRID_SIZE + GRID_SIZE / 2;
      sim.player.y = (centerGy + 2) * GRID_SIZE + GRID_SIZE / 2;
      sim.player.weapon = prof.equippedWeapon;

      const hqMaxHp = Math.round(BUILDING_BLUEPRINTS.hq.baseHp * charStats.buildingHpMultiplier);
      const genMaxHp = Math.round(BUILDING_BLUEPRINTS.generator.baseHp * charStats.buildingHpMultiplier);

      // Усложненная экономика: на старте только Штаб и 1 базовый генератор (турели нужно строить самому)
      sim.buildings = [
        {
          id: 'hq_core',
          type: 'hq',
          gx: centerGx,
          gy: centerGy,
          x: centerGx * GRID_SIZE + GRID_SIZE / 2,
          y: centerGy * GRID_SIZE + GRID_SIZE / 2,
          hp: hqMaxHp,
          maxHp: hqMaxHp,
          level: 1,
          turretAngle: 0,
          recoil: 0,
          pulsePhase: 0,
        },
        {
          id: 'starter_gen_1',
          type: 'generator',
          gx: centerGx - 2,
          gy: centerGy,
          x: (centerGx - 2) * GRID_SIZE + GRID_SIZE / 2,
          y: centerGy * GRID_SIZE + GRID_SIZE / 2,
          hp: genMaxHp,
          maxHp: genMaxHp,
          level: 1,
          turretAngle: 0,
          recoil: 0,
          pulsePhase: 1.2,
        },
      ];
    }

    setProfile(prof);
    setShowSkillsModal(false);
    setScreenState('PLAYING');
  }, []);

  /**
   * Формирование очереди спавна зомби и старт Ночной фазы
   */
  const startNightWave = useCallback(() => {
    const sim = simRef.current;
    if (sim.isNight) return;

    sim.isNight = true;
    sim.buildMode = false;
    sound.playNightSiren();

    const w = sim.wave;
    const totalCount = 10 + w * 6;
    const queue: ZombieVariant[] = [];

    for (let i = 0; i < totalCount; i++) {
      const r = Math.random();
      if (w >= 4 && r < 0.14) {
        queue.push('boomer');
      } else if (w >= 3 && r < 0.3) {
        queue.push('brute');
      } else if (w >= 2 && r < 0.56) {
        queue.push('runner');
      } else {
        queue.push('walker');
      }
    }

    if (w % 5 === 0 || w >= 6) {
      queue.push('boss');
    }

    sim.spawnQueue = queue;
    sim.spawnTimer = 0.5;
  }, []);

  /**
   * Взрыв гранаты, ракеты или мутанта-камикадзе
   */
  const triggerExplosion = useCallback(
    (x: number, y: number, radius: number, damage: number, hurtsStructures = false) => {
      const sim = simRef.current;
      sound.playExplosion();
      sim.shakeTime = 0.22;
      sim.shakeMagnitude = 8;

      for (let i = 0; i < 22; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 210;
        sim.particles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          radius: 3 + Math.random() * 5,
          color: i % 2 === 0 ? '#F97316' : '#FEF08A',
          alpha: 1,
          life: 0.4 + Math.random() * 0.25,
          maxLife: 0.65,
        });
      }

      for (const z of sim.zombies) {
        const dist = Math.hypot(z.x - x, z.y - y);
        if (dist <= radius + z.radius) {
          const falloff = Math.max(0.35, 1 - dist / (radius + z.radius));
          const dmg = Math.round(damage * falloff);
          z.hp -= dmg;
          z.hitFlash = 0.12;
          sim.floatingTexts.push({
            x: z.x + (Math.random() - 0.5) * 14,
            y: z.y - z.radius,
            text: `-${dmg}`,
            color: '#F97316',
            life: 0.55,
            maxLife: 0.55,
          });
        }
      }

      if (hurtsStructures) {
        for (const b of sim.buildings) {
          const dist = Math.hypot(b.x - x, b.y - y);
          if (dist <= radius + 24) {
            b.hp -= damage * 0.65;
          }
        }
      }
    },
    []
  );

  /**
   * Постройка или улучшение/ремонт выбранной клетки на карте
   */
  const handleGridBuildOrInteract = useCallback(
    (gx: number, gy: number) => {
      const sim = simRef.current;
      const charStats = computeCharacterStats(profileRef.current);

      const existing = sim.buildings.find((b) => b.gx === gx && b.gy === gy);
      if (existing) {
        // Сначала пробуем отремонтировать, если повреждено
        if (existing.hp < existing.maxHp) {
          const missingRatio = (existing.maxHp - existing.hp) / existing.maxHp;
          const bp = BUILDING_BLUEPRINTS[existing.type];
          const repairCost = Math.max(5, Math.round((bp.costMetal || 30) * missingRatio * 0.5));
          if (sim.metal >= repairCost) {
            sim.metal -= repairCost;
            existing.hp = existing.maxHp;
            sound.playBuild();
            sim.floatingTexts.push({
              x: existing.x,
              y: existing.y - 18,
              text: 'ОТРЕМОНТИРОВАНО',
              color: '#10B981',
              life: 0.8,
              maxLife: 0.8,
            });
            return;
          }
        }

        // Если здоровье полное и уровень < 3 — улучшаем постройку
        if (existing.type !== 'hq' && existing.level < 3) {
          const bp = BUILDING_BLUEPRINTS[existing.type];
          const upgMetal = Math.round(bp.costMetal * existing.level * 1.15);
          const upgEnergy = Math.round((bp.costEnergy || 10) * existing.level * 1.15);
          if (sim.metal >= upgMetal && sim.energy >= upgEnergy) {
            sim.metal -= upgMetal;
            sim.energy -= upgEnergy;
            existing.level += 1;
            const newMax = Math.round(
              bp.baseHp * charStats.buildingHpMultiplier * (1 + (existing.level - 1) * 0.45)
            );
            existing.maxHp = newMax;
            existing.hp = newMax;
            sound.playBuild();
            sim.floatingTexts.push({
              x: existing.x,
              y: existing.y - 20,
              text: `УРОВЕНЬ ${existing.level}!`,
              color: '#FBBF24',
              life: 0.9,
              maxLife: 0.9,
            });
          } else {
            sim.floatingTexts.push({
              x: existing.x,
              y: existing.y - 20,
              text: 'НЕ ХВАТАЕТ РЕСУРСОВ',
              color: '#EF4444',
              life: 0.7,
              maxLife: 0.7,
            });
          }
        }
        return;
      }

      // Проверка границ и расстояния до Штаба и игрока
      if (gx < 2 || gy < 2 || gx >= WORLD_WIDTH / GRID_SIZE - 2 || gy >= WORLD_HEIGHT / GRID_SIZE - 2) {
        return;
      }

      const hq = sim.buildings.find((b) => b.type === 'hq');
      if (hq && Math.abs(gx - hq.gx) <= 1 && Math.abs(gy - hq.gy) <= 1) {
        return; // Зона центрального реактора Штаба
      }

      const cellCenterX = gx * GRID_SIZE + GRID_SIZE / 2;
      const cellCenterY = gy * GRID_SIZE + GRID_SIZE / 2;
      const bp = BUILDING_BLUEPRINTS[sim.selectedBuildType];

      if (!bp.passableByPlayer && Math.hypot(sim.player.x - cellCenterX, sim.player.y - cellCenterY) < 34) {
        return; // Нельзя застроить самого себя
      }

      if (sim.metal < bp.costMetal || sim.energy < bp.costEnergy) {
        sim.floatingTexts.push({
          x: cellCenterX,
          y: cellCenterY - 12,
          text: 'МАЛО РЕСУРСОВ',
          color: '#EF4444',
          life: 0.75,
          maxLife: 0.75,
        });
        return;
      }

      sim.metal -= bp.costMetal;
      sim.energy -= bp.costEnergy;
      const maxHp = Math.round(bp.baseHp * charStats.buildingHpMultiplier);

      sim.buildings.push({
        id: `bld_${Date.now()}_${Math.random()}`,
        type: sim.selectedBuildType,
        gx,
        gy,
        x: cellCenterX,
        y: cellCenterY,
        hp: maxHp,
        maxHp,
        level: 1,
        turretAngle: 0,
        recoil: 0,
        pulsePhase: Math.random() * Math.PI * 2,
      });

      sound.playBuild();
    },
    []
  );

  /**
   * Игровой цикл 60 FPS и обработка ввода
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const handleBlur = () => {
      simRef.current.input.keys.clear();
      simRef.current.input.mouseDown = false;
      simRef.current.input.rightMouseDown = false;
    };
    window.addEventListener('blur', handleBlur);

    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      simRef.current.input.keys.add(code);

      if (screenStateRef.current === 'TITLE_MENU' && (code === 'Enter' || code === 'Space')) {
        e.preventDefault();
        initGameSession(hasSavedRun);
        return;
      }

      if (screenStateRef.current !== 'PLAYING' && screenStateRef.current !== 'PAUSED') return;

      if (code === 'Escape') {
        if (showSkillsModalRef.current) {
          setShowSkillsModal(false);
        } else {
          setScreenState((prev) => (prev === 'PLAYING' ? 'PAUSED' : 'PLAYING'));
        }
        return;
      }

      if (code === 'KeyC' || code === 'Tab') {
        e.preventDefault();
        setShowSkillsModal((prev) => !prev);
        return;
      }

      if (showSkillsModalRef.current || screenStateRef.current !== 'PLAYING') return;

      const sim = simRef.current;
      if (code === 'KeyB') {
        sim.buildMode = !sim.buildMode;
      } else if (code === 'KeyN' && !sim.isNight) {
        startNightWave();
      } else if (code === 'Digit1') {
        sim.buildMode = false;
        sim.player.weapon = 'pistol';
        setProfile((p) => ({ ...p, equippedWeapon: 'pistol' }));
      } else if (code === 'Digit2' && profileRef.current.weapons.shotgun.unlocked) {
        sim.buildMode = false;
        sim.player.weapon = 'shotgun';
        setProfile((p) => ({ ...p, equippedWeapon: 'shotgun' }));
      } else if (code === 'Digit3' && profileRef.current.weapons.assault.unlocked) {
        sim.buildMode = false;
        sim.player.weapon = 'assault';
        setProfile((p) => ({ ...p, equippedWeapon: 'assault' }));
      } else if (code === 'Digit4' && profileRef.current.weapons.launcher.unlocked) {
        sim.buildMode = false;
        sim.player.weapon = 'launcher';
        setProfile((p) => ({ ...p, equippedWeapon: 'launcher' }));
      } else if (code === 'KeyZ') {
        sim.buildMode = true;
        sim.selectedBuildType = 'wall';
      } else if (code === 'KeyE') {
        sim.buildMode = true;
        sim.selectedBuildType = 'door';
      } else if (code === 'KeyX') {
        sim.buildMode = true;
        sim.selectedBuildType = 'spikes';
      } else if (code === 'KeyV') {
        sim.buildMode = true;
        sim.selectedBuildType = 'generator';
      } else if (code === 'KeyF') {
        sim.buildMode = true;
        sim.selectedBuildType = 'turret_mg';
      } else if (code === 'KeyG') {
        sim.buildMode = true;
        sim.selectedBuildType = 'turret_sniper';
      } else if (code === 'KeyH') {
        sim.buildMode = true;
        sim.selectedBuildType = 'turret_rocket';
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      simRef.current.input.keys.delete(e.code);
    };

    const handleMouseMove = (e: MouseEvent) => {
      simRef.current.input.mouseX = e.clientX;
      simRef.current.input.mouseY = e.clientY;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (screenStateRef.current !== 'PLAYING' || showSkillsModalRef.current) return;
      if (e.button === 0) {
        simRef.current.input.mouseDown = true;
        if (simRef.current.buildMode) {
          const gx = Math.floor(simRef.current.input.worldMouseX / GRID_SIZE);
          const gy = Math.floor(simRef.current.input.worldMouseY / GRID_SIZE);
          handleGridBuildOrInteract(gx, gy);
        }
      } else if (e.button === 2) {
        simRef.current.input.rightMouseDown = true;
        // ПКМ в режиме строительства разбирает постройку с возвратом 60% металла
        if (simRef.current.buildMode) {
          const gx = Math.floor(simRef.current.input.worldMouseX / GRID_SIZE);
          const gy = Math.floor(simRef.current.input.worldMouseY / GRID_SIZE);
          const idx = simRef.current.buildings.findIndex(
            (b) => b.gx === gx && b.gy === gy && b.type !== 'hq'
          );
          if (idx !== -1) {
            const removed = simRef.current.buildings[idx];
            const refund = Math.round(BUILDING_BLUEPRINTS[removed.type].costMetal * 0.6);
            simRef.current.metal += refund;
            simRef.current.buildings.splice(idx, 1);
            simRef.current.floatingTexts.push({
              x: removed.x,
              y: removed.y,
              text: `+${refund}`,
              color: '#94A3B8',
              life: 0.7,
              maxLife: 0.7,
            });
          }
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) simRef.current.input.mouseDown = false;
      if (e.button === 2) simRef.current.input.rightMouseDown = false;
    };

    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);

    let lastTime = performance.now();
    let hudSyncTimer = 0;
    let rafId = 0;

    const tick = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.05);

      const sim = simRef.current;
      const prof = profileRef.current;
      const charStats = computeCharacterStats(prof);

      // Если мы на титульном экране, плавно вращаем камеру вокруг базы
      if (screenStateRef.current === 'TITLE_MENU') {
        sim.time += dt;
        const centerX = WORLD_WIDTH / 2 + Math.cos(sim.time * 0.35) * 140;
        const centerY = WORLD_HEIGHT / 2 + Math.sin(sim.time * 0.35) * 90;
        const camX = centerX - canvas.width / 2;
        const camY = centerY - canvas.height / 2;

        SpriteRenderer.renderWorld(ctx, {
          worldWidth: WORLD_WIDTH,
          worldHeight: WORLD_HEIGHT,
          gridSize: GRID_SIZE,
          cameraX: camX,
          cameraY: camY,
          viewportWidth: canvas.width,
          viewportHeight: canvas.height,
          isNight: true,
          nightFactor: 0.65,
          time: sim.time,
          player: { ...sim.player, angle: sim.time * 0.8 },
          buildings: sim.buildings,
          zombies: [],
          projectiles: [],
          particles: [],
          floatingTexts: [],
          buildMode: false,
          selectedBuildType: 'wall',
          hoverGrid: null,
        });

        rafId = requestAnimationFrame(tick);
        return;
      }

      const isPaused = screenStateRef.current !== 'PLAYING' || showSkillsModalRef.current;

      if (!isPaused) {
        if (sim.hitstopTimer > 0) {
          sim.hitstopTimer -= dt;
        } else {
          sim.time += dt;

          // Плавная смена освещения День / Ночь
          const targetNight = sim.isNight ? 1 : 0;
          sim.nightFactor += (targetNight - sim.nightFactor) * Math.min(1, dt * 2.2);

          // 1. Таймер фазы Дня (строительство) или спавн волн Ночи
          if (!sim.isNight) {
            sim.dayTimer -= dt;
            if (sim.dayTimer <= 0) {
              startNightWave();
            }
          } else {
            // Спавн зомби из очереди по краям арены вокруг базы
            if (sim.spawnQueue.length > 0) {
              sim.spawnTimer -= dt;
              if (sim.spawnTimer <= 0) {
                const variant = sim.spawnQueue.shift()!;
                sim.spawnTimer = Math.max(0.28, 1.15 - sim.wave * 0.06);

                const spawnAngle = Math.random() * Math.PI * 2;
                const spawnDist = 720 + Math.random() * 160;
                const zx = Math.max(
                  60,
                  Math.min(WORLD_WIDTH - 60, WORLD_WIDTH / 2 + Math.cos(spawnAngle) * spawnDist)
                );
                const zy = Math.max(
                  60,
                  Math.min(WORLD_HEIGHT - 60, WORLD_HEIGHT / 2 + Math.sin(spawnAngle) * spawnDist)
                );

                const waveScale = 1 + (sim.wave - 1) * 0.25;
                const variantTable: Record<
                  ZombieVariant,
                  { hp: number; spd: number; dmg: number; rad: number; metal: number; energy: number; xp: number }
                > = {
                  walker: { hp: 70, spd: 90, dmg: 15, rad: 15, metal: 4, energy: 1, xp: 13 },
                  runner: { hp: 48, spd: 152, dmg: 12, rad: 13, metal: 5, energy: 2, xp: 15 },
                  brute: { hp: 250, spd: 60, dmg: 30, rad: 21, metal: 11, energy: 5, xp: 32 },
                  boomer: { hp: 95, spd: 98, dmg: 24, rad: 17, metal: 9, energy: 4, xp: 24 },
                  boss: { hp: 890, spd: 66, dmg: 52, rad: 28, metal: 40, energy: 22, xp: 100 },
                };
                const spec = variantTable[variant];

                sim.zombies.push({
                  id: `z_${Date.now()}_${Math.random()}`,
                  variant,
                  x: zx,
                  y: zy,
                  angle: 0,
                  radius: spec.rad,
                  hp: Math.round(spec.hp * waveScale),
                  maxHp: Math.round(spec.hp * waveScale),
                  speed: spec.spd * (1 + Math.min(0.38, (sim.wave - 1) * 0.028)),
                  damage: Math.round(spec.dmg * (1 + (sim.wave - 1) * 0.14)),
                  walkCycle: Math.random() * 6,
                  hitFlash: 0,
                  attackWindup: 0,
                  attackCooldown: 0,
                  spikeTick: 0,
                  rewardMetal: spec.metal,
                  rewardEnergy: spec.energy,
                  rewardXp: spec.xp,
                });
              }
            } else if (sim.zombies.length === 0) {
              // Волна успешно отбита — наступает новый День!
              sim.isNight = false;
              sim.dayTimer = DAY_DURATION;
              sim.wave += 1;

              const waveBonusMetal = 22 + sim.wave * 7;
              const waveBonusEnergy = 10 + sim.wave * 4;
              sim.metal += waveBonusMetal;
              sim.energy += waveBonusEnergy;

              const expResult = addExperience(profileRef.current, 60 + sim.wave * 20);
              const updatedProf: CharacterProfile = {
                ...expResult.updated,
                highestWave: Math.max(expResult.updated.highestWave, sim.wave),
              };
              profileRef.current = updatedProf;
              setProfile(updatedProf);
              saveCurrentGame(updatedProf, true);

              sim.floatingTexts.push({
                x: sim.player.x,
                y: sim.player.y - 30,
                text: `РАССВЕТ! +${waveBonusMetal} · +${waveBonusEnergy}`,
                color: '#FBBF24',
                life: 1.6,
                maxLife: 1.6,
              });
            }
          }

          // 2. Автоматические генераторы ресурсов внутри базы (каждые 4.0 секунды — усложненная экономика)
          sim.genAccumTimer += dt;
          if (sim.genAccumTimer >= 4.0) {
            sim.genAccumTimer = 0;
            let totalMetalGen = 0;
            let totalEnergyGen = 0;

            for (const b of sim.buildings) {
              if (b.type === 'hq' || b.type === 'generator') {
                const bp = BUILDING_BLUEPRINTS[b.type];
                const lvlMult = 1 + (b.level - 1) * 0.4;
                const m = Math.round((bp.genMetalPerCycle || 0) * lvlMult * charStats.generatorMultiplier);
                const e = Math.round((bp.genEnergyPerCycle || 0) * lvlMult * charStats.generatorMultiplier);
                totalMetalGen += m;
                totalEnergyGen += e;

                if (b.type === 'generator') {
                  sim.floatingTexts.push({
                    x: b.x,
                    y: b.y - 16,
                    text: `+${m} / +${e}`,
                    color: '#10B981',
                    life: 0.9,
                    maxLife: 0.9,
                  });
                }
              }
            }
            sim.metal += totalMetalGen;
            sim.energy += totalEnergyGen;
          }

          // 3. Регенерация здоровья игрока
          sim.player.maxHp = charStats.maxHp;
          sim.regenAccumTimer += dt;
          if (sim.regenAccumTimer >= 1.0) {
            sim.regenAccumTimer = 0;
            if (sim.player.hp > 0 && sim.player.hp < sim.player.maxHp) {
              sim.player.hp = Math.min(sim.player.maxHp, sim.player.hp + charStats.hpRegen);
            }
          }

          // 4. Перемещение игрока (WASD / Стрелки) + коллизии со стенами (сквозь Двери и Шипы игрок проходит свободно)
          let moveX = 0;
          let moveY = 0;
          const keys = sim.input.keys;
          if (keys.has('KeyW') || keys.has('ArrowUp')) moveY -= 1;
          if (keys.has('KeyS') || keys.has('ArrowDown')) moveY += 1;
          if (keys.has('KeyA') || keys.has('ArrowLeft')) moveX -= 1;
          if (keys.has('KeyD') || keys.has('ArrowRight')) moveX += 1;

          if (moveX !== 0 || moveY !== 0) {
            const len = Math.hypot(moveX, moveY);
            moveX /= len;
            moveY /= len;
            sim.player.walkCycle += dt * 11;
          }

          const nextX = sim.player.x + moveX * charStats.moveSpeed * dt;
          const nextY = sim.player.y + moveY * charStats.moveSpeed * dt;
          const pRadius = 15;

          const canMoveTo = (tx: number, ty: number) => {
            if (tx < pRadius + 6 || ty < pRadius + 6 || tx > WORLD_WIDTH - pRadius - 6 || ty > WORLD_HEIGHT - pRadius - 6) {
              return false;
            }
            for (const b of sim.buildings) {
              const bp = BUILDING_BLUEPRINTS[b.type];
              if (!bp.passableByPlayer) {
                const half = b.type === 'hq' ? GRID_SIZE * 0.85 : GRID_SIZE * 0.45;
                if (Math.abs(tx - b.x) < half + pRadius && Math.abs(ty - b.y) < half + pRadius) {
                  return false;
                }
              }
            }
            return true;
          };

          if (canMoveTo(nextX, sim.player.y)) sim.player.x = nextX;
          if (canMoveTo(sim.player.x, nextY)) sim.player.y = nextY;

          // Прицеливание и стрельба игрока
          const camX = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, sim.player.x - canvas.width / 2));
          const camY = Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, sim.player.y - canvas.height / 2));
          sim.input.worldMouseX = sim.input.mouseX + camX;
          sim.input.worldMouseY = sim.input.mouseY + camY;

          sim.player.angle = Math.atan2(
            sim.input.worldMouseY - sim.player.y,
            sim.input.worldMouseX - sim.player.x
          );

          sim.player.fireCooldown = Math.max(0, sim.player.fireCooldown - dt);
          sim.player.muzzleFlash = Math.max(0, sim.player.muzzleFlash - dt);
          sim.player.hitFlash = Math.max(0, sim.player.hitFlash - dt);

          const wantsShoot = (sim.input.mouseDown && !sim.buildMode) || keys.has('Space');
          if (wantsShoot && sim.player.fireCooldown <= 0) {
            const wStats = getEffectiveWeaponStats(prof, sim.player.weapon);
            sim.player.fireCooldown = 1 / wStats.fireRate;
            sim.player.muzzleFlash = 0.055;
            sound.playShoot(sim.player.weapon);

            for (let i = 0; i < wStats.pellets; i++) {
              const spreadAngle =
                sim.player.angle + (Math.random() - 0.5) * wStats.spread;
              sim.projectiles.push({
                x: sim.player.x + Math.cos(sim.player.angle) * 22,
                y: sim.player.y + Math.sin(sim.player.angle) * 22,
                vx: Math.cos(spreadAngle) * wStats.bulletSpeed,
                vy: Math.sin(spreadAngle) * wStats.bulletSpeed,
                radius: sim.player.weapon === 'launcher' ? 6 : 3.5,
                color: wStats.color,
                isRocket: sim.player.weapon === 'launcher',
                damage: wStats.damage,
                explosionRadius: wStats.explosionRadius,
                life: 1.4,
              });
            }
          }

          // 5. Работа автоматических башен (Плавный пулемет, Цепная молния Тесла, РСЗО HIMARS)
          for (const b of sim.buildings) {
            b.recoil = Math.max(0, b.recoil - dt * 5);
            if (b.laserTimer && b.laserTimer > 0) {
              b.laserTimer = Math.max(0, b.laserTimer - dt);
            }

            if (b.type === 'turret_mg' || b.type === 'turret_sniper' || b.type === 'turret_rocket') {
              const bp = BUILDING_BLUEPRINTS[b.type];
              const lvlScale = 1 + (b.level - 1) * 0.35;
              const range = (bp.range || 250) * (1 + (b.level - 1) * 0.1);
              const fireRate = (bp.fireRate || 1) * charStats.turretPowerMultiplier * (1 + (b.level - 1) * 0.15);
              const damage = Math.round((bp.damage || 20) * lvlScale * charStats.turretPowerMultiplier);

              b.pulsePhase = Math.max(0, b.pulsePhase - dt);

              // Ищем ближайшего зомби в радиусе
              let nearest: (typeof sim.zombies)[0] | null = null;
              let bestDist = range;
              for (const z of sim.zombies) {
                const d = Math.hypot(z.x - b.x, z.y - b.y);
                if (d < bestDist) {
                  bestDist = d;
                  nearest = z;
                }
              }

              if (nearest) {
                if (b.type === 'turret_sniper') {
                  // 1) КАТУШКА ТЕСЛА: не требует разворота ствола, бьет цепной молнией до 3-4 целей!
                  if (b.pulsePhase <= 0) {
                    b.pulsePhase = 1 / fireRate;
                    sound.playTurretShoot('sniper');

                    const maxChains = 2 + b.level; // Ур.1: 3 цели, Ур.2: 4 цели, Ур.3: 5 целей
                    const chainRange = 135;
                    const hitIds = new Set<string>([nearest.id]);
                    const arcs: { x1: number; y1: number; x2: number; y2: number }[] = [
                      { x1: b.x, y1: b.y, x2: nearest.x, y2: nearest.y },
                    ];

                    // Урон основной цели
                    nearest.hp -= damage;
                    nearest.hitFlash = 0.14;
                    sim.floatingTexts.push({
                      x: nearest.x,
                      y: nearest.y - nearest.radius,
                      text: `⚡-${damage}`,
                      color: '#38BDF8',
                      life: 0.5,
                      maxLife: 0.5,
                    });

                    // Цепные перескоки молнии на соседних зомби
                    let currentSource = nearest;
                    for (let c = 1; c < maxChains; c++) {
                      let nextTarget: (typeof sim.zombies)[0] | null = null;
                      let minDist = chainRange;
                      for (const cand of sim.zombies) {
                        if (hitIds.has(cand.id) || cand.hp <= 0) continue;
                        const d = Math.hypot(cand.x - currentSource.x, cand.y - currentSource.y);
                        if (d < minDist) {
                          minDist = d;
                          nextTarget = cand;
                        }
                      }
                      if (!nextTarget) break;

                      hitIds.add(nextTarget.id);
                      const chainDmg = Math.round(damage * Math.pow(0.75, c));
                      nextTarget.hp -= chainDmg;
                      nextTarget.hitFlash = 0.14;
                      arcs.push({
                        x1: currentSource.x,
                        y1: currentSource.y,
                        x2: nextTarget.x,
                        y2: nextTarget.y,
                      });
                      sim.floatingTexts.push({
                        x: nextTarget.x,
                        y: nextTarget.y - nextTarget.radius,
                        text: `⚡-${chainDmg}`,
                        color: '#7DD3FC',
                        life: 0.5,
                        maxLife: 0.5,
                      });
                      currentSource = nextTarget;
                    }

                    b.teslaArcs = arcs;
                    b.laserTimer = 0.18;
                  }
                } else {
                  // 2) и 3) Плавное сервоприводное наведение для Пулеметной турели и РСЗО HIMARS
                  const desiredAngle = Math.atan2(nearest.y - b.y, nearest.x - b.x);
                  let angleDiff = desiredAngle - b.turretAngle;
                  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                  const turnSpeed = b.type === 'turret_mg' ? 7.2 : 4.5; // рад/сек
                  const maxStep = turnSpeed * dt;
                  if (Math.abs(angleDiff) <= maxStep) {
                    b.turretAngle = desiredAngle;
                  } else {
                    b.turretAngle += Math.sign(angleDiff) * maxStep;
                  }

                  // Стреляем только когда ствол/пакет HIMARS уже наведен на цель
                  if (Math.abs(angleDiff) < 0.32 && b.pulsePhase <= 0) {
                    b.pulsePhase = 1 / fireRate;
                    b.recoil = 1;

                    if (b.type === 'turret_rocket') {
                      // Пуск реактивной ракеты из пакета HIMARS
                      sound.playTurretShoot('rocket');
                      const tubeOffset = ((Math.floor(sim.time * 10) % 3) - 1) * 5;
                      const perpAngle = b.turretAngle + Math.PI / 2;
                      sim.projectiles.push({
                        x: b.x + Math.cos(b.turretAngle) * 16 + Math.cos(perpAngle) * tubeOffset,
                        y: b.y + Math.sin(b.turretAngle) * 16 + Math.sin(perpAngle) * tubeOffset,
                        vx: Math.cos(b.turretAngle) * 540,
                        vy: Math.sin(b.turretAngle) * 540,
                        radius: 5.5,
                        color: '#EF4444',
                        isRocket: true,
                        damage,
                        explosionRadius: Math.round((bp.explosionRadius || 88) * charStats.explosionRadiusMultiplier),
                        life: 1.4,
                      });
                    } else {
                      sound.playTurretShoot('mg');
                      sim.projectiles.push({
                        x: b.x + Math.cos(b.turretAngle) * 18,
                        y: b.y + Math.sin(b.turretAngle) * 18,
                        vx: Math.cos(b.turretAngle) * 760,
                        vy: Math.sin(b.turretAngle) * 760,
                        radius: 3,
                        color: '#FBBF24',
                        isRocket: false,
                        damage,
                        explosionRadius: 0,
                        life: 0.9,
                      });
                    }
                  }
                }
              }
            }
          }

          // 6. Полет снарядов и попадания
          for (let i = sim.projectiles.length - 1; i >= 0; i--) {
            const p = sim.projectiles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;

            let hit = false;
            for (const z of sim.zombies) {
              if (Math.hypot(p.x - z.x, p.y - z.y) <= z.radius + p.radius + 2) {
                hit = true;
                if (p.explosionRadius > 0) {
                  triggerExplosion(p.x, p.y, p.explosionRadius, p.damage, false);
                } else {
                  z.hp -= p.damage;
                  z.hitFlash = 0.1;
                  sim.floatingTexts.push({
                    x: z.x + (Math.random() - 0.5) * 10,
                    y: z.y - z.radius,
                    text: `-${p.damage}`,
                    color: p.color,
                    life: 0.45,
                    maxLife: 0.45,
                  });
                  for (let k = 0; k < 4; k++) {
                    const ang = Math.random() * Math.PI * 2;
                    sim.particles.push({
                      x: z.x,
                      y: z.y,
                      vx: Math.cos(ang) * 70,
                      vy: Math.sin(ang) * 70,
                      radius: 2.5,
                      color: '#84CC16',
                      alpha: 0.9,
                      life: 0.25,
                      maxLife: 0.25,
                    });
                  }
                }
                break;
              }
            }

            if (hit || p.life <= 0 || p.x < 0 || p.y < 0 || p.x > WORLD_WIDTH || p.y > WORLD_HEIGHT) {
              if (!hit && p.life <= 0 && p.explosionRadius > 0) {
                triggerExplosion(p.x, p.y, p.explosionRadius, p.damage, false);
              }
              sim.projectiles.splice(i, 1);
            }
          }

          // 7. ИИ зомби, шипы, атаки по стенам/дверям/Штабу/игроку и гибель зомби
          const hq = sim.buildings.find((b) => b.type === 'hq');

          for (let i = sim.zombies.length - 1; i >= 0; i--) {
            const z = sim.zombies[i];

            if (z.hp <= 0) {
              // Гибель зомби
              if (z.variant === 'boomer') {
                triggerExplosion(z.x, z.y, 72, 42, true);
              }
              sim.metal += z.rewardMetal;
              sim.energy += z.rewardEnergy;

              const expRes = addExperience(profileRef.current, z.rewardXp);
              const nextProf: CharacterProfile = {
                ...expRes.updated,
                totalKills: expRes.updated.totalKills + 1,
              };
              profileRef.current = nextProf;
              setProfile(nextProf);

              for (let k = 0; k < 9; k++) {
                const ang = Math.random() * Math.PI * 2;
                const spd = 25 + Math.random() * 90;
                sim.particles.push({
                  x: z.x,
                  y: z.y,
                  vx: Math.cos(ang) * spd,
                  vy: Math.sin(ang) * spd,
                  radius: 3 + Math.random() * 3,
                  color: z.variant === 'boomer' ? '#10B981' : '#65A30D',
                  alpha: 0.85,
                  life: 0.45,
                  maxLife: 0.45,
                });
              }

              sim.zombies.splice(i, 1);
              continue;
            }

            z.hitFlash = Math.max(0, z.hitFlash - dt);
            z.attackCooldown = Math.max(0, z.attackCooldown - dt);
            z.attackWindup = Math.max(0, z.attackWindup - dt);
            z.spikeTick = Math.max(0, z.spikeTick - dt);

            // Проверка нахождения зомби на клетке с шипами
            const zgx = Math.floor(z.x / GRID_SIZE);
            const zgy = Math.floor(z.y / GRID_SIZE);
            const spikeCell = sim.buildings.find(
              (b) => b.type === 'spikes' && b.gx === zgx && b.gy === zgy
            );

            let speedMult = 1;
            if (spikeCell) {
              speedMult = 0.48; // шипы замедляют зомби
              if (z.spikeTick <= 0) {
                z.spikeTick = 0.55;
                const spikeDmg = Math.round((BUILDING_BLUEPRINTS.spikes.damage || 22) * (1 + (spikeCell.level - 1) * 0.4));
                z.hp -= spikeDmg;
                z.hitFlash = 0.08;
                spikeCell.hp -= 4;
              }
            }

            // Выбор цели: игрок (если близко) или Штаб
            const distToPlayer = Math.hypot(sim.player.x - z.x, sim.player.y - z.y);
            const targetX = distToPlayer < 260 || !hq ? sim.player.x : hq.x;
            const targetY = distToPlayer < 260 || !hq ? sim.player.y : hq.y;

            z.angle = Math.atan2(targetY - z.y, targetX - z.x);
            const stepX = z.x + Math.cos(z.angle) * z.speed * speedMult * dt;
            const stepY = z.y + Math.sin(z.angle) * z.speed * speedMult * dt;

            // Проверка столкновения с постройками на пути (Двери и Стены не пропускают зомби)
            let blockingBuilding: RenderBuilding | null = null;
            for (const b of sim.buildings) {
              const bp = BUILDING_BLUEPRINTS[b.type];
              if (bp.passableByZombie) continue;
              const hitRadius = b.type === 'hq' ? GRID_SIZE * 0.9 : GRID_SIZE * 0.52;
              if (Math.hypot(stepX - b.x, stepY - b.y) < hitRadius + z.radius) {
                blockingBuilding = b;
                break;
              }
            }

            if (blockingBuilding) {
              if (z.attackCooldown <= 0) {
                z.attackCooldown = 0.85;
                z.attackWindup = 0.2;
                blockingBuilding.hp -= z.damage;
                sim.floatingTexts.push({
                  x: blockingBuilding.x,
                  y: blockingBuilding.y - 10,
                  text: `-${z.damage}`,
                  color: '#EF4444',
                  life: 0.4,
                  maxLife: 0.4,
                });
              }
            } else if (distToPlayer < z.radius + 16) {
              // Атака игрока вблизи
              if (z.attackCooldown <= 0) {
                z.attackCooldown = 0.9;
                z.attackWindup = 0.22;
                sim.player.hp -= z.damage;
                sim.player.hitFlash = 0.18;
                sim.shakeTime = 0.07;
                sim.shakeMagnitude = 1.2;
              }
            } else {
              z.x = stepX;
              z.y = stepY;
              z.walkCycle += dt * 9;
            }
          }

          // Удаление разрушенных построек и проверка поражения
          for (let i = sim.buildings.length - 1; i >= 0; i--) {
            if (sim.buildings[i].hp <= 0) {
              const destroyed = sim.buildings[i];
              if (destroyed.type === 'hq') {
                SaveManager.clearActiveRun(profileRef.current);
                setHasSavedRun(false);
                setScreenState('GAME_OVER');
              }
              sim.buildings.splice(i, 1);
            }
          }

          if (sim.player.hp <= 0 && screenStateRef.current === 'PLAYING') {
            SaveManager.clearActiveRun(profileRef.current);
            setHasSavedRun(false);
            setScreenState('GAME_OVER');
          }

          // Обновление частиц и всплывающего текста
          for (let i = sim.particles.length - 1; i >= 0; i--) {
            const pt = sim.particles[i];
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.vx *= 0.92;
            pt.vy *= 0.92;
            pt.life -= dt;
            if (pt.life <= 0) sim.particles.splice(i, 1);
          }

          for (let i = sim.floatingTexts.length - 1; i >= 0; i--) {
            sim.floatingTexts[i].life -= dt;
            if (sim.floatingTexts[i].life <= 0) sim.floatingTexts.splice(i, 1);
          }
        }
      }

      // Расчет камеры с мягкой и ограниченной отдачей (чтобы не трясло при толпах зомби)
      let shakeX = 0;
      let shakeY = 0;
      if (sim.shakeTime > 0) {
        sim.shakeTime = Math.max(0, sim.shakeTime - dt);
        const clampedMag = Math.min(2.0, sim.shakeMagnitude) * (sim.shakeTime / 0.1);
        shakeX = (Math.random() - 0.5) * clampedMag;
        shakeY = (Math.random() - 0.5) * clampedMag;
      }

      const camX =
        Math.max(0, Math.min(WORLD_WIDTH - canvas.width, sim.player.x - canvas.width / 2)) + shakeX;
      const camY =
        Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, sim.player.y - canvas.height / 2)) + shakeY;

      const hoverGx = Math.floor((sim.input.mouseX + camX) / GRID_SIZE);
      const hoverGy = Math.floor((sim.input.mouseY + camY) / GRID_SIZE);
      const existingAtHover = sim.buildings.find((b) => b.gx === hoverGx && b.gy === hoverGy);
      const hq = sim.buildings.find((b) => b.type === 'hq');
      const nearHq = hq && Math.abs(hoverGx - hq.gx) <= 1 && Math.abs(hoverGy - hq.gy) <= 1;
      const bp = BUILDING_BLUEPRINTS[sim.selectedBuildType];
      const cellValid =
        !existingAtHover &&
        !nearHq &&
        hoverGx >= 2 &&
        hoverGy >= 2 &&
        hoverGx < WORLD_WIDTH / GRID_SIZE - 2 &&
        hoverGy < WORLD_HEIGHT / GRID_SIZE - 2 &&
        sim.metal >= bp.costMetal &&
        sim.energy >= bp.costEnergy;

      // Отрисовка мира через модуль SpriteRenderer
      SpriteRenderer.renderWorld(ctx, {
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT,
        gridSize: GRID_SIZE,
        cameraX: camX,
        cameraY: camY,
        viewportWidth: canvas.width,
        viewportHeight: canvas.height,
        isNight: sim.isNight,
        nightFactor: sim.nightFactor,
        time: sim.time,
        player: sim.player,
        buildings: sim.buildings,
        zombies: sim.zombies,
        projectiles: sim.projectiles,
        particles: sim.particles,
        floatingTexts: sim.floatingTexts,
        buildMode: sim.buildMode,
        selectedBuildType: sim.selectedBuildType,
        hoverGrid: {
          gx: hoverGx,
          gy: hoverGy,
          valid: cellValid,
          existingBuilding: existingAtHover,
        },
      });

      // Отслеживание задержки при наведении на уже стоящую постройку (0.28 сек)
      if (sim.buildMode && existingAtHover) {
        if (sim.hoverHoldId === existingAtHover.id) {
          sim.hoverHoldTime += dt;
        } else {
          sim.hoverHoldId = existingAtHover.id;
          sim.hoverHoldTime = 0;
        }
      } else {
        sim.hoverHoldId = null;
        sim.hoverHoldTime = 0;
      }

      // Синхронизация HUD (10 раз в секунду для экономии рендеров React)
      hudSyncTimer += dt;
      if (hudSyncTimer >= 0.08) {
        hudSyncTimer = 0;
        let hoveredBuildingInfo = null;
        if (sim.buildMode && existingAtHover && sim.hoverHoldTime >= 0.28) {
          const ebp = BUILDING_BLUEPRINTS[existingAtHover.type];
          const missingRatio = (existingAtHover.maxHp - existingAtHover.hp) / existingAtHover.maxHp;
          hoveredBuildingInfo = {
            id: existingAtHover.id,
            type: existingAtHover.type,
            level: existingAtHover.level,
            hp: Math.round(existingAtHover.hp),
            maxHp: Math.round(existingAtHover.maxHp),
            upgradeMetal: Math.round(ebp.costMetal * existingAtHover.level * 1.15),
            upgradeEnergy: Math.round((ebp.costEnergy || 10) * existingAtHover.level * 1.15),
            repairMetal: Math.max(5, Math.round((ebp.costMetal || 30) * missingRatio * 0.5)),
            screenX: existingAtHover.x - camX,
            screenY: existingAtHover.y - camY,
          };
        }

        setHudState({
          wave: sim.wave,
          isNight: sim.isNight,
          dayTimer: Math.max(0, Math.ceil(sim.dayTimer)),
          zombiesRemaining: sim.zombies.length + sim.spawnQueue.length,
          metal: Math.floor(sim.metal),
          energy: Math.floor(sim.energy),
          playerHp: Math.max(0, Math.round(sim.player.hp)),
          playerMaxHp: Math.round(sim.player.maxHp),
          hqHp: hq ? Math.max(0, Math.round(hq.hp)) : 0,
          hqMaxHp: hq ? Math.round(hq.maxHp) : 1200,
          buildMode: sim.buildMode,
          selectedBuildType: sim.selectedBuildType,
          equippedWeapon: sim.player.weapon,
          hoveredBuildingInfo,
        });
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [handleGridBuildOrInteract, hasSavedRun, initGameSession, saveCurrentGame, startNightWave, triggerExplosion]);

  // Прокачка навыка персонажа
  const handleUpgradeSkill = (skillId: SkillId) => {
    const def = SKILL_DEFINITIONS.find((s) => s.id === skillId);
    if (!def) return;
    const currentLvl = profile.skills[skillId];
    if (profile.skillPoints <= 0 || currentLvl >= def.maxLevel) return;

    const updated: CharacterProfile = {
      ...profile,
      skillPoints: profile.skillPoints - 1,
      skills: {
        ...profile.skills,
        [skillId]: currentLvl + 1,
      },
    };

    // Пересчитываем здоровье построек и игрока при прокачке
    const newStats = computeCharacterStats(updated);
    simRef.current.player.maxHp = newStats.maxHp;
    simRef.current.player.hp = Math.min(newStats.maxHp, simRef.current.player.hp + 25);

    profileRef.current = updated;
    setProfile(updated);
    saveCurrentGame(updated, true);
  };

  // Разблокировка или улучшение оружия (Дробовик, Автомат, Гранатомет)
  const handleUnlockOrUpgradeWeapon = (weaponId: WeaponId) => {
    const sim = simRef.current;
    const wState = profile.weapons[weaponId];
    const wCfg = WEAPON_CONFIGS[weaponId];
    const eff = getEffectiveWeaponStats(profile, weaponId);

    if (!wState.unlocked) {
      if (sim.metal < wCfg.unlockCostMetal || sim.energy < wCfg.unlockCostEnergy) return;
      sim.metal -= wCfg.unlockCostMetal;
      sim.energy -= wCfg.unlockCostEnergy;

      const updated: CharacterProfile = {
        ...profile,
        equippedWeapon: weaponId,
        weapons: {
          ...profile.weapons,
          [weaponId]: { unlocked: true, level: 1 },
        },
      };
      sim.player.weapon = weaponId;
      profileRef.current = updated;
      setProfile(updated);
      saveCurrentGame(updated, true);
    } else if (wState.level < 5) {
      if (sim.metal < eff.upgradeMetalCost || sim.energy < eff.upgradeEnergyCost) return;
      sim.metal -= eff.upgradeMetalCost;
      sim.energy -= eff.upgradeEnergyCost;

      const updated: CharacterProfile = {
        ...profile,
        weapons: {
          ...profile.weapons,
          [weaponId]: { unlocked: true, level: wState.level + 1 },
        },
      };
      profileRef.current = updated;
      setProfile(updated);
      saveCurrentGame(updated, true);
    }
  };

  const toggleMute = () => {
    sound.muted = !sound.muted;
    setIsMuted(sound.muted);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0F141C] select-none">
      {/* Изолированный 60fps Canvas игрового мира */}
      <canvas ref={canvasRef} className="block w-full h-full cursor-crosshair" />

      {/* Уведомление об авто/ручном сохранении */}
      {saveToast && (
        <div className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-emerald-500/50 text-emerald-300 px-4 py-1.5 rounded-md text-xs font-medium tracking-wide shadow-lg">
          {saveToast}
        </div>
      )}

      {/* ==================== ТИТУЛЬНЫЙ ЭКРАН (TITLE MENU) ==================== */}
      {screenState === 'TITLE_MENU' && (
        <div className="fixed inset-0 z-30 flex flex-col justify-between p-8 md:p-14 bg-gradient-to-t from-[#0B0F17]/95 via-[#0B0F17]/65 to-[#0B0F17]/80">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400 font-mono-num">
              УРОВЕНЬ КОМАНДИРА: {profile.level} · РЕКОРД ВОЛНЫ: {profile.highestWave} · УБИТО ЗОМБИ: {profile.totalKills}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={toggleMute}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/90 border border-slate-700 text-xs text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
                <span>{isMuted ? 'Звук выкл.' : 'Звук вкл.'}</span>
              </button>

              <span className="text-xs font-mono-num text-amber-400 font-bold tracking-wider">
                v{GAME_VERSION}
              </span>
            </div>
          </div>

          {/* Центральный логотип и кнопки старта с воздухом вокруг */}
          <div className="my-auto max-w-2xl">
            <div className="mb-4">
              <svg viewBox="0 0 540 110" className="w-full max-w-lg h-auto">
                <defs>
                  <linearGradient id="bastionGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FDE047" />
                    <stop offset="55%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#EA580C" />
                  </linearGradient>
                </defs>
                <polygon points="16,18 52,18 68,54 52,90 16,90 4,54" fill="none" stroke="url(#bastionGrad)" strokeWidth="5" />
                <circle cx="36" cy="54" r="12" fill="url(#bastionGrad)" />
                <text
                  x="88"
                  y="78"
                  fill="#F8FAFC"
                  fontFamily="Oswald, sans-serif"
                  fontWeight="700"
                  fontSize="74"
                  letterSpacing="4"
                >
                  BASTION
                </text>
                <text
                  x="398"
                  y="78"
                  fill="url(#bastionGrad)"
                  fontFamily="Oswald, sans-serif"
                  fontWeight="700"
                  fontSize="74"
                >
                  Z
                </text>
              </svg>
            </div>

            <p className="text-slate-300 text-base md:text-lg max-w-xl mb-8 leading-relaxed">
              Защищайте главный Штаб-Генератор базы. Днем возводите стены, сенсорные бронедвери, шипы, генераторы
              ресурсов и турели 3 типов, а ночью отбивайте волны мутантов из дробовика, автомата и гранатомета.
            </p>

            <div className="flex flex-wrap items-center gap-3.5">
              {hasSavedRun && (
                <button
                  onClick={() => initGameSession(true)}
                  className="flex items-center gap-2.5 px-7 py-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm tracking-wide transition-transform active:scale-95 cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Продолжить оборону базы</span>
                </button>
              )}

              <button
                onClick={() => initGameSession(false)}
                className={`flex items-center gap-2.5 px-7 py-3.5 rounded-lg font-semibold text-sm tracking-wide transition-transform active:scale-95 cursor-pointer ${
                  hasSavedRun
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20'
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Новая кампания (с сохранением навыков)</span>
              </button>

              <button
                onClick={() => setShowControlsModal(true)}
                className="flex items-center gap-2 px-5 py-3.5 rounded-lg bg-slate-800/95 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-sm font-semibold transition-colors cursor-pointer"
              >
                <Keyboard className="w-4 h-4 text-amber-400" />
                <span>Управление</span>
              </button>

              <button
                onClick={() => {
                  const fresh = SaveManager.resetAll();
                  setProfile(fresh.profile);
                  setHasSavedRun(false);
                  triggerSaveToast('Весь прогресс сброшен');
                }}
                className="flex items-center gap-2 px-4 py-3.5 rounded-lg bg-slate-900/90 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 text-xs font-medium transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить профиль</span>
              </button>
            </div>
          </div>

          <div />
        </div>
      )}

      {/* ==================== МОДАЛЬНОЕ ОКНО УПРАВЛЕНИЯ (CONTROLS MODAL) ==================== */}
      {showControlsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl bg-[#131B26] border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Keyboard className="w-5 h-5 text-amber-400" />
                <h2 className="font-display text-xl font-bold tracking-wide text-white uppercase">
                  Управление и горячие клавиши
                </h2>
              </div>
              <button
                onClick={() => setShowControlsModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Закрыть [Esc]
              </button>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2.5 bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-amber-400 mb-2">
                  Перемещение и Бой
                </h3>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Движение персонажа</span>
                  <span className="font-mono-num font-bold text-white">WASD / Стрелки</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Стрельба по прицелу</span>
                  <span className="font-mono-num font-bold text-white">ЛКМ / Пробел</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Выбор оружия</span>
                  <span className="font-mono-num font-bold text-white">1 · 2 · 3 · 4</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Навыки героя и Арсенал</span>
                  <span className="font-mono-num font-bold text-white">C / Tab</span>
                </div>
              </div>

              <div className="space-y-2.5 bg-slate-900/80 border border-slate-800 rounded-lg p-4">
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-emerald-400 mb-2">
                  Строительство и База
                </h3>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Смена меню Оружие / Стройка</span>
                  <span className="font-mono-num font-bold text-emerald-400">B</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Построить / Улучшить / Ремонт</span>
                  <span className="font-mono-num font-bold text-white">ЛКМ</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Снести постройку (возврат 60%)</span>
                  <span className="font-mono-num font-bold text-white">ПКМ</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Чертежи построек</span>
                  <span className="font-mono-num font-bold text-white">Z · E · X · V · F · G · H</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Досрочно начать ночь</span>
                  <span className="font-mono-num font-bold text-rose-400">N</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== БОЕВОЙ ПЕРИМЕТРАЛЬНЫЙ HUD (PLAYING) ==================== */}
      {screenState === 'PLAYING' && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-4">
          {/* Верхняя тактическая панель */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/* Здоровье Игрока, Штаба и Уровень */}
            <div className="pointer-events-auto flex items-center gap-4 bg-[#111822]/92 border border-slate-700/80 rounded-lg px-4 py-2.5 shadow-md">
              <div className="flex flex-col gap-1 min-w-[140px]">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Heart className="w-3.5 h-3.5 text-emerald-400" /> Выживший
                  </span>
                  <span className="font-mono-num text-emerald-400 font-bold">
                    {hudState.playerHp}/{hudState.playerMaxHp}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-150"
                    style={{ width: `${Math.min(100, (hudState.playerHp / hudState.playerMaxHp) * 100)}%` }}
                  />
                </div>
              </div>

              <div className="h-7 w-px bg-slate-800" />

              <div className="flex flex-col gap-1 min-w-[155px]">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Shield className="w-3.5 h-3.5 text-amber-400" /> Штаб базы
                  </span>
                  <span className="font-mono-num text-amber-400 font-bold">
                    {hudState.hqHp}/{hudState.hqMaxHp}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-150"
                    style={{ width: `${Math.min(100, (hudState.hqHp / hudState.hqMaxHp) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Индикатор День / Ночь и Номер Волны */}
            <div className="pointer-events-auto flex items-center gap-4 bg-[#111822]/92 border border-slate-700/80 rounded-lg px-5 py-2.5 shadow-md">
              <div className="flex items-center gap-2.5">
                {hudState.isNight ? (
                  <Moon className="w-5 h-5 text-rose-400" />
                ) : (
                  <Sun className="w-5 h-5 text-amber-400" />
                )}
                <div>
                  <div className="font-display text-sm tracking-wider uppercase font-bold text-white">
                    ВОЛНА {hudState.wave} · {hudState.isNight ? 'НОЧНАЯ АТАКА' : 'ДЕНЬ (СТРОИТЕЛЬСТВО)'}
                  </div>
                  <div className="text-xs text-slate-400 font-mono-num">
                    {hudState.isNight
                      ? `Осталось врагов: ${hudState.zombiesRemaining}`
                      : `До наступления темноты: ${hudState.dayTimer} сек`}
                  </div>
                </div>
              </div>

              {!hudState.isNight && (
                <button
                  onClick={startNightWave}
                  className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold tracking-wide transition-colors cursor-pointer whitespace-nowrap"
                >
                  Начать ночь [N]
                </button>
              )}
            </div>

            {/* Ресурсы (только иконки + число), Кнопки Навыков / Сохранения / Звука и Версия справа вверху */}
            <div className="pointer-events-auto flex items-center gap-3 bg-[#111822]/92 border border-slate-700/80 rounded-lg px-4 py-2.5 shadow-md">
              <div className="flex items-center gap-1.5 text-xs font-mono-num" title="Металл">
                <Wrench className="w-4 h-4 text-slate-300" />
                <span className="text-white font-bold text-sm">{hudState.metal}</span>
              </div>

              <div className="h-5 w-px bg-slate-800" />

              <div className="flex items-center gap-1.5 text-xs font-mono-num" title="Энергия">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-amber-400 font-bold text-sm">{hudState.energy}</span>
              </div>

              <div className="h-5 w-px bg-slate-800" />

              <button
                onClick={() => setShowSkillsModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Award className="w-3.5 h-3.5" />
                <span>Герой и Арсенал [C]</span>
                {profile.skillPoints > 0 && (
                  <span className="ml-1 font-mono-num font-bold text-amber-300">+{profile.skillPoints}</span>
                )}
              </button>

              <button
                onClick={() => saveCurrentGame(profile, true)}
                title="Сохранить игру"
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
              </button>

              <button
                onClick={toggleMute}
                title="Звук"
                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-amber-400" />}
              </button>

              <div className="h-5 w-px bg-slate-800" />

              <span className="text-xs font-mono-num text-slate-400 font-bold tracking-wider">
                v{GAME_VERSION}
              </span>
            </div>
          </div>

          {/* Небольшая читаемая плашка при наведении на стоящую постройку (появляется с задержкой) */}
          {hudState.buildMode && hudState.hoveredBuildingInfo && (
            <div
              className="pointer-events-none fixed z-30 -translate-x-1/2 -translate-y-full flex flex-col items-center gap-1 bg-[#0F1622]/95 border border-slate-600/90 rounded-lg px-3 py-1.5 shadow-xl transition-opacity duration-150"
              style={{
                left: `${Math.max(95, Math.min(window.innerWidth - 95, hudState.hoveredBuildingInfo.screenX))}px`,
                top: `${Math.max(85, hudState.hoveredBuildingInfo.screenY - 30)}px`,
              }}
            >
              {/* Верхняя строка: только стоимость улучшения (или ремонта / макс. ур.) */}
              <div className="flex items-center justify-center gap-2.5 text-xs font-mono-num font-bold">
                {hudState.hoveredBuildingInfo.hp < hudState.hoveredBuildingInfo.maxHp ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Wrench className="w-3.5 h-3.5 text-slate-300" />
                    {hudState.hoveredBuildingInfo.repairMetal}
                  </span>
                ) : hudState.hoveredBuildingInfo.type !== 'hq' && hudState.hoveredBuildingInfo.level < 3 ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-white">
                      <Wrench className="w-3.5 h-3.5 text-slate-300" />
                      {hudState.hoveredBuildingInfo.upgradeMetal}
                    </span>
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <Zap className="w-3.5 h-3.5" />
                      {hudState.hoveredBuildingInfo.upgradeEnergy}
                    </span>
                  </>
                ) : (
                  <span className="text-emerald-400 text-[11px] tracking-wide">МАКС. УР.</span>
                )}
              </div>

              {/* Нижняя строка: краткое управление взаимодействием */}
              <div className="text-[10px] text-slate-400 font-medium whitespace-nowrap border-t border-slate-800 pt-1">
                {hudState.hoveredBuildingInfo.hp < hudState.hoveredBuildingInfo.maxHp
                  ? hudState.hoveredBuildingInfo.type === 'hq'
                    ? 'ЛКМ Ремонт'
                    : 'ЛКМ Ремонт · ПКМ Снос'
                  : hudState.hoveredBuildingInfo.type === 'hq'
                  ? 'Штаб базы'
                  : hudState.hoveredBuildingInfo.level < 3
                  ? 'ЛКМ Улучшить · ПКМ Снос'
                  : 'ПКМ Снос'}
              </div>
            </div>
          )}

          {/* Нижняя зона: РАЗДЕЛЬНЫЕ МЕНЮ ОРУЖИЯ И СТРОЙКИ (переключаются кнопкой B) */}
          <div className="pointer-events-auto mx-auto flex flex-col items-center gap-2">
            {!hudState.buildMode ? (
              /* МЕНЮ 1: АРСЕНАЛ ОРУЖИЯ */
              <div className="flex flex-wrap items-center justify-center gap-2 bg-[#111822]/95 border border-slate-700/80 rounded-xl p-2 shadow-xl">
                <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-display tracking-wider uppercase text-amber-400">
                  <Crosshair className="w-4 h-4" />
                  <span>Оружие</span>
                </div>

                {(['pistol', 'shotgun', 'assault', 'launcher'] as WeaponId[]).map((wId) => {
                  const cfg = WEAPON_CONFIGS[wId];
                  const st = profile.weapons[wId];
                  const isSelected = hudState.equippedWeapon === wId;
                  return (
                    <button
                      key={wId}
                      onClick={() => {
                        if (!st.unlocked) {
                          setActiveModalTab('weapons');
                          setShowSkillsModal(true);
                          return;
                        }
                        simRef.current.player.weapon = wId;
                        setProfile((p) => ({ ...p, equippedWeapon: wId }));
                      }}
                      className={`flex flex-col items-start px-3.5 py-1.5 rounded-lg border text-left transition-colors cursor-pointer min-w-[115px] ${
                        isSelected
                          ? 'bg-amber-500/20 border-amber-400 text-white'
                          : st.unlocked
                          ? 'bg-slate-900/90 border-slate-700/80 text-slate-300 hover:border-slate-500'
                          : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full text-[11px] font-mono-num">
                        <span className="text-amber-400 font-bold">[{cfg.hotkey}]</span>
                        <span>{st.unlocked ? `Ур.${st.level}` : 'Закрыто'}</span>
                      </div>
                      <div className="text-xs font-semibold truncate max-w-[115px]">
                        {cfg.name.split(' ')[1] || cfg.name}
                      </div>
                    </button>
                  );
                })}

                <div className="h-7 w-px bg-slate-800 mx-1" />

                <button
                  onClick={() => {
                    simRef.current.buildMode = true;
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/50 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Hammer className="w-4 h-4" />
                  <span>Меню стройки [B]</span>
                </button>
              </div>
            ) : (
              /* МЕНЮ 2: ИНЖЕНЕРНОЕ СТРОИТЕЛЬСТВО БАЗЫ */
              <div className="flex flex-wrap items-center justify-center gap-2 bg-[#111822]/95 border border-emerald-500/50 rounded-xl p-2 shadow-xl">
                <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-display tracking-wider uppercase text-emerald-400">
                  <Hammer className="w-4 h-4" />
                  <span>Стройка</span>
                </div>

                {BUILDABLE_TYPES.map((bType) => {
                  const bp = BUILDING_BLUEPRINTS[bType];
                  const isSelected = hudState.selectedBuildType === bType;
                  const canAfford = hudState.metal >= bp.costMetal && hudState.energy >= bp.costEnergy;
                  return (
                    <button
                      key={bType}
                      onClick={() => {
                        simRef.current.selectedBuildType = bType;
                      }}
                      className={`flex flex-col items-start px-3 py-1.5 rounded-lg border text-left transition-colors cursor-pointer min-w-[110px] ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-400 text-white'
                          : canAfford
                          ? 'bg-slate-900/90 border-slate-700/80 text-slate-200 hover:border-slate-500'
                          : 'bg-slate-950/70 border-slate-800 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full text-[11px] font-mono-num gap-2">
                        <span className="text-emerald-400 font-bold">[{bp.hotkey}]</span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-0.5">
                            <Wrench className="w-3 h-3 text-slate-300" />
                            {bp.costMetal}
                          </span>
                          {bp.costEnergy > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-amber-400">
                              <Zap className="w-3 h-3" />
                              {bp.costEnergy}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="text-xs font-semibold whitespace-nowrap">{bp.shortName}</div>
                    </button>
                  );
                })}

                <div className="h-7 w-px bg-slate-800 mx-1" />

                <button
                  onClick={() => {
                    simRef.current.buildMode = false;
                  }}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/50 text-amber-300 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Crosshair className="w-4 h-4" />
                  <span>Меню оружия [B]</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== МОДАЛЬНОЕ ОКНО НАВЫКОВ И АРСЕНАЛА (CHARACTER & WEAPONS) ==================== */}
      {showSkillsModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-4xl bg-[#131B26] border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            {/* Шапка */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <div>
                <h2 className="font-display text-xl font-bold tracking-wide text-white uppercase">
                  Профиль Выжившего и Модернизация Арсенала
                </h2>
                <div className="flex items-center gap-3 text-xs text-slate-400 font-mono-num mt-0.5">
                  <span>
                    Уровень {profile.level} · Опыт {profile.xp}/{profile.xpToNext}
                  </span>
                  <span>·</span>
                  <span>
                    Очки навыков: <span className="text-amber-400 font-bold">{profile.skillPoints}</span>
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-white">
                    <Wrench className="w-3.5 h-3.5 text-slate-300" />
                    {hudState.metal}
                  </span>
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <Zap className="w-3.5 h-3.5" />
                    {hudState.energy}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setActiveModalTab('skills')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                      activeModalTab === 'skills' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Навыки персонажа ({profile.skillPoints})
                  </button>
                  <button
                    onClick={() => setActiveModalTab('weapons')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                      activeModalTab === 'weapons' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Прокачка оружия
                  </button>
                </div>

                <button
                  onClick={() => setShowSkillsModal(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                >
                  Закрыть [Esc]
                </button>
              </div>
            </div>

            {/* Контент вкладок */}
            <div className="p-6 overflow-y-auto space-y-6">
              {activeModalTab === 'skills' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {SKILL_DEFINITIONS.map((sk) => {
                    const lvl = profile.skills[sk.id];
                    const canUpgrade = profile.skillPoints > 0 && lvl < sk.maxLevel;
                    return (
                      <div
                        key={sk.id}
                        className="flex flex-col justify-between p-4 rounded-lg bg-slate-900/90 border border-slate-800"
                      >
                        <div>
                          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                            <span>{sk.branchLabel}</span>
                            <span className="font-mono-num text-amber-400 font-bold">
                              Ур. {lvl}/{sk.maxLevel}
                            </span>
                          </div>
                          <h3 className="text-sm font-bold text-white mb-1">{sk.name}</h3>
                          <p className="text-xs text-slate-400 leading-relaxed mb-2">{sk.description}</p>
                          <div className="text-xs text-emerald-400 font-mono-num mb-4">{sk.effectPerLevelLabel}</div>
                        </div>

                        <button
                          disabled={!canUpgrade}
                          onClick={() => handleUpgradeSkill(sk.id)}
                          className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-semibold transition-colors ${
                            lvl >= sk.maxLevel
                              ? 'bg-slate-800 text-emerald-400 cursor-default'
                              : canUpgrade
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          <span>{lvl >= sk.maxLevel ? 'Максимум' : 'Изучить (1 очко)'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(['pistol', 'shotgun', 'assault', 'launcher'] as WeaponId[]).map((wId) => {
                    const eff = getEffectiveWeaponStats(profile, wId);
                    const canBuy = !eff.unlocked
                      ? hudState.metal >= eff.unlockCostMetal && hudState.energy >= eff.unlockCostEnergy
                      : eff.level < 5 &&
                        hudState.metal >= eff.upgradeMetalCost &&
                        hudState.energy >= eff.upgradeEnergyCost;

                    return (
                      <div
                        key={wId}
                        className="flex flex-col justify-between p-5 rounded-lg bg-slate-900/90 border border-slate-800"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="text-base font-bold text-white">{eff.name}</h3>
                            <span className="text-xs font-mono-num text-amber-400 font-bold">
                              {eff.unlocked ? `Уровень ${eff.level}/5` : 'Не разблокировано'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mb-3">{eff.description}</p>
                          <div className="text-xs text-slate-300 font-mono-num space-y-1 mb-4">
                            <div>
                              Урон: <span className="text-white font-bold">{eff.damage}</span>{' '}
                              {eff.pellets > 1 ? `× ${eff.pellets} дробин` : ''}
                            </div>
                            <div>
                              Темп стрельбы: <span className="text-white font-bold">{eff.fireRate} выстр/сек</span>
                            </div>
                            {eff.explosionRadius > 0 && (
                              <div>
                                Радиус взрыва: <span className="text-amber-400 font-bold">{eff.explosionRadius} px</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            disabled={!canBuy || (eff.unlocked && eff.level >= 5)}
                            onClick={() => handleUnlockOrUpgradeWeapon(wId)}
                            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-xs font-semibold transition-colors ${
                              eff.unlocked && eff.level >= 5
                                ? 'bg-slate-800 text-emerald-400 cursor-default'
                                : canBuy
                                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {!eff.unlocked ? (
                              <>
                                <span>Открыть</span>
                                <span className="inline-flex items-center gap-1 font-mono-num">
                                  <Wrench className="w-3.5 h-3.5" />
                                  {eff.unlockCostMetal}
                                </span>
                                <span className="inline-flex items-center gap-1 font-mono-num">
                                  <Zap className="w-3.5 h-3.5" />
                                  {eff.unlockCostEnergy}
                                </span>
                              </>
                            ) : eff.level >= 5 ? (
                              <span>Максимальный уровень</span>
                            ) : (
                              <>
                                <span>Улучшить</span>
                                <span className="inline-flex items-center gap-1 font-mono-num">
                                  <Wrench className="w-3.5 h-3.5" />
                                  {eff.upgradeMetalCost}
                                </span>
                                <span className="inline-flex items-center gap-1 font-mono-num">
                                  <Zap className="w-3.5 h-3.5" />
                                  {eff.upgradeEnergyCost}
                                </span>
                              </>
                            )}
                          </button>

                          {eff.unlocked && (
                            <button
                              onClick={() => {
                                simRef.current.player.weapon = wId;
                                simRef.current.buildMode = false;
                                setProfile((p) => ({ ...p, equippedWeapon: wId }));
                              }}
                              className={`py-2 px-3 rounded-md text-xs font-semibold cursor-pointer ${
                                profile.equippedWeapon === wId
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                              }`}
                            >
                              {profile.equippedWeapon === wId ? 'В руках' : 'Взять'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== ПАУЗА (PAUSED) ==================== */}
      {screenState === 'PAUSED' && !showSkillsModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md bg-[#131B26] border border-slate-700 rounded-xl p-6 text-center space-y-5 shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white uppercase tracking-wide">Игра на паузе</h2>
            <p className="text-xs text-slate-400">
              Волна {hudState.wave} · Ваш прогресс персонажа и навыков автоматически синхронизируется.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => setScreenState('PLAYING')}
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm cursor-pointer"
              >
                Продолжить бой
              </button>
              <button
                onClick={() => {
                  saveCurrentGame(profile, true);
                  setScreenState('TITLE_MENU');
                }}
                className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm cursor-pointer"
              >
                Сохранить и выйти в главное меню
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ЭКРАН ПОРАЖЕНИЯ (GAME OVER) ==================== */}
      {screenState === 'GAME_OVER' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md bg-[#131B26] border border-rose-500/40 rounded-xl p-7 text-center space-y-5 shadow-2xl">
            <Skull className="w-12 h-12 text-rose-500 mx-auto" />
            <div>
              <h2 className="font-display text-3xl font-bold text-white uppercase tracking-wide">Периметр прорван</h2>
              <p className="text-xs text-slate-400 mt-1">
                База пала на волне <span className="text-amber-400 font-mono-num font-bold">{hudState.wave}</span>. Все
                изученные навыки и уровень командира ({profile.level}) сохранены!
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => initGameSession(false)}
                className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm cursor-pointer"
              >
                Отстроить базу заново (Волна 1)
              </button>
              <button
                onClick={() => setScreenState('TITLE_MENU')}
                className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer"
              >
                В главное меню
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
