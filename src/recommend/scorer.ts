import type { SongProfile } from './profile';
import { hourToPeriod } from './profile';

/** 评分权重（经验默认值，可通过 API 覆盖）*/
export interface ScoreWeights {
  /** 播放热度权重 */
  plays: number;
  /** 切歌惩罚权重 */
  skipPenalty: number;
  /** 当前时段偏好权重 */
  timeAffinity: number;
  /** 久未播放加成权重（宝藏挖掘）*/
  staleness: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  plays: 1.0,
  skipPenalty: 1.2,
  timeAffinity: 0.6,
  staleness: 0.4,
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** staleness 饱和天数：超过 60 天未听视为"最久" */
const STALENESS_SATURATION_DAYS = 60;

/** 播放热度归一化：log 压缩避免头部歌曲垄断 */
function playScore(plays: number, maxPlays: number): number {
  if (maxPlays <= 0 || plays <= 0) return 0;
  return Math.log1p(plays) / Math.log1p(maxPlays);
}

/** 切歌率：skips / (plays + skips)，拉普拉斯平滑避免小样本极端值（无数据时基准 0.5）*/
export function skipRate(plays: number, skips: number): number {
  return (skips + 1) / (plays + skips + 2);
}

/** 当前时段亲和度：该歌在当前时段的播放占比（拉普拉斯平滑）*/
function timeAffinity(periodCounts: number[], nowPeriod: number): number {
  const total = periodCounts.reduce((a, b) => a + b, 0);
  // +1/+4 平滑：无数据时每个时段均为 0.25（中性）
  return (periodCounts[nowPeriod] + 1) / (total + 4);
}

/** 久未播放程度：0（刚听过）→ 1（60 天以上没听）*/
function staleness(lastPlayedAt: number, now: number): number {
  if (lastPlayedAt <= 0) return 1;
  const days = (now - lastPlayedAt) / DAY_MS;
  return Math.min(1, Math.max(0, days / STALENESS_SATURATION_DAYS));
}

/** 综合评分（各分量归一化后加权；timeAffinity 占比基准 0.25 映射到中性 0）*/
export function scoreSong(p: SongProfile, maxPlays: number, now: number, w: ScoreWeights): number {
  const nowPeriod = hourToPeriod(new Date(now).getHours());
  return (
    w.plays * playScore(p.plays, maxPlays) -
    w.skipPenalty * skipRate(p.plays, p.skips) +
    w.timeAffinity * (timeAffinity(p.periodCounts, nowPeriod) * 4 - 1) +
    w.staleness * staleness(p.lastPlayedAt, now)
  );
}

/** 加权随机抽样（分数越高越容易被选中，但保留随机性）*/
export function weightedSample<T>(items: { item: T; score: number }[], count: number): T[] {
  if (items.length <= count) return items.map((x) => x.item);

  // 分数平移到正区间作为抽样权重
  const minScore = Math.min(...items.map((x) => x.score));
  const pool = items.map((x) => ({ item: x.item, weight: x.score - minScore + 0.1 }));
  const result: T[] = [];

  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * totalWeight;
    let picked = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].weight;
      if (r <= 0) {
        picked = j;
        break;
      }
    }
    result.push(pool[picked].item);
    pool.splice(picked, 1);
  }
  return result;
}
