import { Controller, Get, Logger } from '@nestjs/common';
import { ManifestService, SystemManifest } from './manifest.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('System')
@Controller('system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(private readonly manifestService: ManifestService) {}

  @Get('manifest')
  @ApiOperation({ summary: 'Get institutional system manifest' })
  @ApiResponse({ status: 200, description: 'Success' })
  async getManifest(): Promise<SystemManifest> {
    return this.manifestService.generateManifest();
  }
}
