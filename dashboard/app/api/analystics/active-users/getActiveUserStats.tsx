import { duckdb } from "@/lib/duckdb"

import {
  DateRangeKey,
  getDateRangeCondition,
  getPreviousDateRangeCondition,
} from "../utils"

export type UserStats = {
  time: string // Represents either a day or a month
  polygon: number // Count of active users on Polygon
  momoka: number // Count of active users on Momoka
  total: number // Total count of active users
}

export async function getAllNetworkUserStats(
  statType: "DAU" | "MAU" = "DAU"
): Promise<{ [key in DateRangeKey]?: UserStats[] }> {
  const rangeKeys: DateRangeKey[] = ["1D", "1W", "1M", "3M", "1Y", "ALL"]
  const allStats: { [key in DateRangeKey]?: UserStats[] } = {}

  for (const rangeKey of rangeKeys) {
    const userStatsForRange = await getNetworkUserStats(rangeKey, statType)
    allStats[rangeKey] = userStatsForRange
  }

  return allStats
}

export async function getNetworkUserStats(
  rangeKey: DateRangeKey,
  statType: "DAU" | "MAU" = "DAU"
) {
  const timeUnit = statType === "DAU" ? "day" : "month"

  let sql = `
    SELECT 
      DATE_TRUNC('${timeUnit}', block_timestamp)::date as ${timeUnit}, 
      COUNT(DISTINCT CASE WHEN is_momoka THEN profile_id END) AS momoka,
      COUNT(DISTINCT CASE WHEN NOT is_momoka THEN profile_id END) AS polygon
    FROM publication_record
  `
  sql += getDateRangeCondition(rangeKey, "block_timestamp")
  sql += `
    GROUP BY ${timeUnit}
    ORDER BY ${timeUnit}
  `

  const userStats = await duckdb.all(sql)

  const chartData = userStats.map((a) => ({
    time: new Date(a[timeUnit]).toLocaleDateString(),
    polygon: Number(a.polygon),
    momoka: Number(a.momoka),
    total: Number(a.polygon) + Number(a.momoka),
  }))

  return chartData as UserStats[]
}

export async function getDauGrowthPercentages(rangeKey: DateRangeKey) {
  // Define SQL query for the current period
  let currentPeriodSql = `
    SELECT COUNT(DISTINCT profile_id) as total
    FROM publication_record
  `
  currentPeriodSql += getDateRangeCondition(rangeKey, "block_timestamp")

  // Define SQL query for the previous period
  let previousPeriodSql = `
    SELECT COUNT(DISTINCT profile_id) as total
    FROM publication_record
  `
  previousPeriodSql += getPreviousDateRangeCondition(
    rangeKey,
    "block_timestamp"
  )

  // Execute queries
  const currentPeriodData = await duckdb.all(currentPeriodSql)
  const previousPeriodData = await duckdb.all(previousPeriodSql)

  // Extract total counts
  const currentTotal = Number(currentPeriodData[0].total || 0)
  const previousTotal = Number(previousPeriodData[0].total || 0)

  // Calculate growth percentage
  let growthPercentage = 0
  if (previousTotal > 0) {
    growthPercentage = parseFloat(
      (((currentTotal - previousTotal) / previousTotal) * 100).toFixed(2)
    )
  }

  return growthPercentage
}

export type AppUserStats = {
  apps: string[]
  stats: {
    time: string
    [key: string]: number | string // Dynamic keys for each app
  }[]
}

const topApps = [
  "phaver",
  "hey",
  "orb",
  "buttrfly",
  "kaira",
  "t2.world",
  "tape",
  "lenster",
]

export async function getAllAppUserStats(
  statType: "DAU" | "MAU"
): Promise<{ [key in DateRangeKey]?: AppUserStats }> {
  const rangeKeys: DateRangeKey[] = ["1D", "1W", "1M", "3M", "1Y", "ALL"]
  const allStats: { [key in DateRangeKey]?: AppUserStats } = {}

  for (const rangeKey of rangeKeys) {
    const userStatsForRange = await getAppUserStats(rangeKey, statType)
    allStats[rangeKey] = userStatsForRange
  }

  return allStats
}

export async function getAppUserStats(
  rangeKey: DateRangeKey,
  statType: "DAU" | "MAU"
) {
  const timeUnit = statType === "DAU" ? "day" : "month"

  // Fetch user stats per app for each time unit
  let userStatsSql = `
    SELECT 
      DATE_TRUNC('${timeUnit}', block_timestamp)::date as ${timeUnit}, 
      app, 
      COUNT(DISTINCT profile_id) AS users
    FROM publication_record
  `
  userStatsSql += getDateRangeCondition(rangeKey, "block_timestamp")
  userStatsSql += `
    GROUP BY ${timeUnit}, app
    ORDER BY ${timeUnit}, app
  `
  const userStats = await duckdb.all(userStatsSql)

  // Initialize the result structure
  const result = {
    apps: topApps.map((app) => app.charAt(0).toUpperCase() + app.slice(1)), // Capitalize first letter
    stats: [] as any[],
  }

  userStats.forEach((stat) => {
    // Ensure stat.app is a string and not null or undefined
    const appName =
      stat.app && typeof stat.app === "string"
        ? stat.app.charAt(0).toUpperCase() + stat.app.slice(1)
        : "Others"

    const appCategory = result.apps.includes(appName) ? appName : "Others"

    // Find or create the stat entry for the time unit
    let statEntry = result.stats.find(
      (s) => s.time === new Date(stat[timeUnit]).toLocaleDateString()
    ) as any
    if (!statEntry) {
      statEntry = { time: new Date(stat[timeUnit]).toLocaleDateString() }
      result.apps.forEach((app) => (statEntry[app] = 0)) // Initialize all apps with 0 users
      result.stats.push(statEntry)
    }

    // Add the user count to the appropriate app category
    statEntry[appCategory] = (statEntry[appCategory] || 0) + Number(stat.users)
  })

  // Add "Others" to handle apps not in the topApps list
  result.apps.push("Others")

  return result as AppUserStats
}
