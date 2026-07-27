import { Controller, Get, Module } from "@nestjs/common";

@Controller("stores")
class StoresController {
  @Get("health")
  health() {
    return { ok: true };
  }
}

@Module({
  controllers: [StoresController],
})
export class StoresModule {}
