import { Module } from "@nestjs/common";

import { AuthModule } from "./modules/auth/auth.module";
import { BillingModule } from "./modules/billing/billing.module";
import { HealthModule } from "./modules/health/health.module";
import { PlatformsModule } from "./modules/platforms/platforms.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { ScansModule } from "./modules/scans/scans.module";
import { StoresModule } from "./modules/stores/stores.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    StoresModule,
    ScansModule,
    PlatformsModule,
    ReportsModule,
    BillingModule,
  ],
})
export class AppModule {}
