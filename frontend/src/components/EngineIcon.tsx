import { SiPostgresql, SiMysql, SiSqlite, SiRedis, SiApachekafka } from "react-icons/si";
import type { IconType } from "react-icons";
import type { Engine } from "@/lib/types";

const ENGINE_ICONS: Record<Engine, IconType> = {
  postgres: SiPostgresql,
  mysql: SiMysql,
  sqlite: SiSqlite,
  redis: SiRedis,
  kafka: SiApachekafka,
};

export function EngineIcon({
  engine,
  size = 16,
  className,
}: {
  engine: Engine;
  size?: number;
  className?: string;
}) {
  const Icon = ENGINE_ICONS[engine];
  return <Icon size={size} className={className} />;
}
