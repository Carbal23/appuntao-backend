import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiAuth } from 'src/common/swagger/auth.decorator';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { ReqContext } from 'src/common/decorators/request-context.decorator';
import type { RequestContext } from 'src/auth-log/auth-log.types';
import { LegalService } from './legal.service';
import { AcceptLegalDocumentsDto } from './dto/accept-legal-documents.dto';
import { LegalDocumentResponseDto } from './dto/legal-document-response.dto';
import { CurrentLegalDocumentsQueryDto } from './dto/current-legal-documents-query.dto';

@ApiTags('Legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Documentos legales vigentes',
    description:
      'Público. Devuelve la versión vigente de cada tipo de documento del catálogo, con su texto, en el orden en que se deben mostrar. El registro envía los ids de audience=ALL_USERS en acceptedLegalDocumentIds; la creación de un negocio, los de audience=BUSINESS_OWNERS.',
  })
  @ApiResponse({ status: 200, type: [LegalDocumentResponseDto] })
  getCurrent(@Query() query: CurrentLegalDocumentsQueryDto) {
    return this.legalService.getCurrentDocuments(query.audience);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Get('pending')
  @ApiOperation({
    summary: 'Documentos que el usuario autenticado aún no ha aceptado',
  })
  @ApiResponse({ status: 200, type: [LegalDocumentResponseDto] })
  getPending(@GetUser('id') userId: string) {
    return this.legalService.getPendingDocuments(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiAuth()
  @Post('accept')
  @ApiOperation({
    summary: 'Aceptar documentos pendientes',
    description:
      'Registra la aceptación de los documentos indicados (deben ser la versión vigente) y devuelve los que sigan pendientes.',
  })
  @ApiResponse({ status: 201, type: [LegalDocumentResponseDto] })
  @ApiResponse({
    status: 400,
    description: 'Algún documento no es la versión vigente',
  })
  accept(
    @GetUser('id') userId: string,
    @Body() dto: AcceptLegalDocumentsDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.legalService.acceptDocuments(userId, dto.documentIds, context);
  }
}
