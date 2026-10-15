import { FolderOfPipe } from './folder-of-pipe';

describe('FolderOfPipe', () => {
  it('create an instance', () => {
    const pipe = new FolderOfPipe();
    expect(pipe).toBeTruthy();
  });

  it.each([
    ['anime/show/ep1.mkv', 'anime/show'],
    ['/anime//show/ep1.mkv', 'anime/show'],
    ['ep1.mkv', ''],
    [null, ''],
  ])('takes the folder of %s', (filePath, folder) => {
    expect(new FolderOfPipe().transform(filePath as string)).toBe(folder);
  });
});
