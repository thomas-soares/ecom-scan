import { Controller, Get, Module } from "@nestjs/common";

@Controller("billing")
class BillingController {
  @Get("health")
  health() {
    return {
      ok: true,
      status: "reserved",
    };
  }
}

@Module({
  controllers: [BillingController],
})
export class BillingModule {}
