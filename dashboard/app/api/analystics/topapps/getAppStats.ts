import { duckdb, toParquetSql } from "@/lib/duckdb"

import "server-only"

import { apps } from "@/config/apps"

import { DateRangeKey, getDateRangeCondition } from "../utils"

export async function getTotalApps() {
  const result = await duckdb.all(
    toParquetSql(
      `SELECT COUNT(DISTINCT app) AS count FROM publication_metadata;`
    )
  )
  console.log(result)
  return result[0] ? Number(result[0].count) : 0
}

export type TopApps = {
  name: string
  value: number
  description?: string
  icon?: string
  url?: string
}[]

export async function getTopApps(rangeKey: DateRangeKey) {
  let sql = `
  SELECT app AS name, COUNT(*) AS value FROM publication_metadata
  `
  sql += getDateRangeCondition(rangeKey, "timestamp")
  sql += ` GROUP BY name ORDER BY value DESC LIMIT 50;`

  const result = await duckdb.all(toParquetSql(sql))

  // convert bigint to number and check if name is empty
  result.forEach((r) => {
    r.value = Number(r.value)
    if (!r.name) {
      r.name = "other"
    }

    const allApps = apps.find(
      (app) => app.name.toLowerCase() === r.name.toLowerCase()
    )
    if (allApps) {
      r.description = allApps.description
      r.icon = allApps.icon
      r.url = allApps.url
    }
  })

  return result as TopApps
}
