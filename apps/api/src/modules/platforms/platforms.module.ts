import { Controller, Get, Module } from "@nestjs/common";

@Controller("platforms")
class PlatformsController {
  @Get("supported")
  supported() {
    return {
      items: ["meta", "google", "tiktok", "pinterest", "snapchat", "klaviyo"],
    };
  }
}

@Module({
  controllers: [PlatformsController],
})
export class PlatformsModule {}
