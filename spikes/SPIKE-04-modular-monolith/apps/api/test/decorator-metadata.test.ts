import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class Clock {
  now() {
    return 'tick';
  }
}

// Inyección por TIPO (sin @Inject): depende de `design:paramtypes` emitido por el transformador.
@Injectable()
class UsesClockByType {
  constructor(readonly clock: Clock) {}
}

@Module({ providers: [Clock, UsesClockByType] })
class M {}

describe('decorator metadata bajo Vitest', () => {
  it('emite design:paramtypes (necesario solo para inyección por tipo)', async () => {
    const paramtypes = Reflect.getMetadata('design:paramtypes', UsesClockByType) as unknown[] | undefined;
    const ref = await Test.createTestingModule({ imports: [M] }).compile();
    const svc = ref.get(UsesClockByType);
    console.log(`[metadata] paramtypes=${paramtypes ? 'presente' : 'AUSENTE'} clock=${svc.clock ? 'inyectado' : 'undefined'}`);
    expect(paramtypes).toEqual([Clock]);
    expect(svc.clock.now()).toBe('tick');
  });
});
