import { describe, expect, it } from "vitest";
import { Presenca, PRESENCA_VALIDADE_MS } from "../src/presenca.js";
import { Store } from "../src/store.js";
import type { DebateInfo } from "../src/shared/types.js";

const debate = {
  titulo: "Teste",
  data: "2026-10-23",
  pais: "Brasil",
  candidatos: [],
  outros_falantes: [],
  marca: { nome: "Byte Fact Check", rodape: "agência byte" },
} as unknown as DebateInfo;

describe("Presenca", () => {
  it("conta cada navegador uma vez e tira quem fechou ou sumiu", () => {
    const p = new Presenca();
    for (const id of ["aaaaaaaa", "bbbbbbbb", "aaaaaaaa"]) p.bater(id);
    expect(p.ciclo()).toEqual({ online: 2, novos: 2 });

    p.bater("bbbbbbbb", true);
    expect(p.ciclo()).toEqual({ online: 1, novos: 0 });

    expect(p.ciclo(Date.now() + PRESENCA_VALIDADE_MS + 1)).toEqual({ online: 0, novos: 0 });
  });

  it("em novo debate, quem está na sala conta uma vez como visitante", () => {
    const p = new Presenca();
    p.bater("aaaaaaaa");
    p.ciclo();
    p.bater("cccccccc"); // chega junto com a troca de debate
    p.ciclo(); // cccccccc já foi somado ao debate novo
    p.novaSessao();
    expect(p.ciclo()).toEqual({ online: 2, novos: 1 }); // só aaaaaaaa
    expect(p.ciclo()).toEqual({ online: 2, novos: 0 });
  });
});

describe("Store.registrarPresenca", () => {
  it("soma as fatias, guarda o pico e zera ao encerrar", () => {
    const store = new Store(debate, { autoPublish: true });
    const sessao = store.registrarPresenca("f1", 10, 10);
    store.registrarPresenca("f2", 5, 5);
    expect(store.audiencia()).toEqual({ online: 15, pico: 15, visitantes: 15 });

    store.registrarPresenca("f1", 2, 1);
    expect(store.audiencia()).toEqual({ online: 7, pico: 15, visitantes: 16 });

    const resumo = store.encerrar();
    expect(resumo).toMatchObject({ pico: 15, visitantes: 16 });
    expect(store.registrarPresenca("f1", 2, 0)).not.toBe(sessao);
    expect(store.audiencia().visitantes).toBe(0);
  });
});
